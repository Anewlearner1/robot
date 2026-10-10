// Logic / robustness regression checks for 屍潮斷橋 (fixed timestep, pause, double game over, reset, centre-line gates,
// iteration safety, pool limits). Exit code 1 if any check fails or the page logs an error.
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_THREE = '/tmp/claude-0/-home-user-robot/e63d82bf-e5cf-557e-842c-86e09e28f838/scratchpad/vendor/three.min.js';
const three = process.env.THREE_JS || DEFAULT_THREE;
const html = process.env.ZB_HTML || path.resolve(here, '../index.html');

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 200, height: 200 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
// Take over requestAnimationFrame so the checks can feed frame() synthetic timestamps; fake document.hidden.
await page.addInitScript(() => {
  window.__raf = null;
  window.requestAnimationFrame = cb => { window.__raf = cb; return 1; };
  window.__hidden = false;
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => window.__hidden });
});
await page.route('**/three.min.js', r => r.fulfill({ body: fs.readFileSync(three), contentType: 'application/javascript' }));
await page.route('https://fonts.**', r => r.abort());
await page.goto('file://' + html);
await page.waitForFunction(() => window.__zb);
await page.evaluate(() => document.getElementById('mute').click());

const results = await page.evaluate(() => {
  const out = [];
  const check = (name, ok, detail) => out.push({ name, ok: !!ok, detail: detail === undefined ? '' : String(detail) });
  const zb = window.__zb, G = zb.G, Z = zb.Z;
  let seed = 99;
  Math.random = () => { seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const counts = { gameOver: 0, win: 0, bossDied: 0, contact: 0 };
  zb.bus.on('gameOver', () => counts.gameOver++);
  zb.bus.on('win', () => counts.win++);
  zb.bus.on('bossDied', () => counts.bossDied++);
  zb.bus.on('soldierContact', () => counts.contact++);
  const reset = () => { counts.gameOver = counts.win = counts.bossDied = counts.contact = 0; };
  const sig = () => JSON.stringify(G.events.map(e => [e.type, +e.z.toFixed(3), +(e.x || 0).toFixed(3), e.side || 0, e.val || 0, e.kind || '', e.tier || 0, e.need || 0, e.pair, e.spec ? [e.spec.kind, e.spec.count, +e.spec.hp.toFixed(3), +e.spec.cx.toFixed(3)] : 0]));
  const now0 = () => performance.now();

  // ---------------------------------------------------------------- 1. fixed timestep
  for (const fps of [30, 60, 120, 144, 20]) {
    zb.prepare(1); zb.start();
    const t0 = now0();
    const frames = fps * 3;
    let maxSteps = 0, prev = G.time;
    for (let i = 1; i <= frames; i++) {
      G.shield = 1e9;
      window.__raf(t0 + i * 1000 / fps);
      maxSteps = Math.max(maxSteps, Math.round((G.time - prev) / (1 / 60)));
      prev = G.time;
    }
    check(`fixed step @${fps} fps: 3 s of wall clock = ${G.time.toFixed(2)} s of game time`, Math.abs(G.time - 3) < 0.06, G.time);
    check(`fixed step @${fps} fps: never more than 4 steps in one frame`, maxSteps <= 4, maxSteps);
  }
  {
    zb.prepare(1); zb.start();
    const t0 = now0();
    for (let i = 1; i <= 40; i++) { G.shield = 1e9; window.__raf(t0 + i * 200); }       // 5 fps: far below the catch-up budget
    check('slow device (5 fps): at most 4 steps per frame, no spiral of death', G.time <= 40 * 4 / 60 + 0.01 && G.time > 40 * 3 / 60, G.time);
  }
  // ---------------------------------------------------------------- 2. pause when hidden
  {
    zb.prepare(1); zb.start();
    const t0 = now0();
    for (let i = 1; i <= 30; i++) { G.shield = 1e9; window.__raf(t0 + i * 16.667); }
    const before = G.time, zBefore = G.z;
    window.__hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
    for (let i = 1; i <= 50; i++) window.__raf(t0 + 500 + i * 1000);                    // 50 s of timers firing while hidden
    check('hidden tab: simulation frozen', G.time === before && G.z === zBefore, `${G.time} vs ${before}`);
    window.__hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    const t1 = now0();
    window.__raf(t1 + 16.7);
    window.__raf(t1 + 33.4);
    check('resume after hiding: no time jump', G.time - before < 5 / 60 + 1e-6, (G.time - before).toFixed(4));
    // even if the visibilitychange event never arrives, the first visible frame must not catch up the hidden time
    window.__hidden = true; window.__raf(t1 + 40000); window.__hidden = false;
    const mid = G.time; window.__raf(t1 + 40016.7);
    check('resume without visibilitychange: no time jump', G.time - mid < 3 / 60, (G.time - mid).toFixed(4));
  }
  // ---------------------------------------------------------------- 3. game over / win fire once
  {
    reset(); zb.prepare(2); zb.start();
    G.squad = 3; zb.syncSoldiers(); G.shield = 0;
    zb.spawnHorde({ kind: 'test', cx: G.x, w: 1, d: 1, count: 400, hp: 1 }, G.z - 0.3);
    for (let i = 0; i < 120; i++) zb.step(1 / 60);
    check('wipe-out: phase is over', G.phase === 'over', G.phase);
    check('wipe-out: gameOver emitted exactly once', counts.gameOver === 1, counts.gameOver);
    check('wipe-out: squad is 0 and no soldiers left', G.squad === 0 && G.soldiers.length === 0, `${G.squad}/${G.soldiers.length}`);
    for (let i = 0; i < 120; i++) zb.step(1 / 60);
    check('wipe-out: still once after more steps', counts.gameOver === 1 && G.phase === 'over', counts.gameOver);
  }
  {
    reset(); zb.prepare(1); zb.start();
    G.squad = 25; G.weapon = 3; zb.syncSoldiers(); G.shield = 1e9;
    G.z = -G.L + 2;
    let guard = 0;
    while (G.phase !== 'win' && guard++ < 6000) { G.shield = Math.max(G.shield, 5); zb.step(1 / 60); }
    check('boss kill leads to win', G.phase === 'win', `${G.phase} after ${guard} steps`);
    check('win emitted exactly once, bossDied once', counts.win === 1 && counts.bossDied === 1, `${counts.win}/${counts.bossDied}`);
    // the victory lap is safe: zombies landing on the squad must neither kill soldiers nor trigger game over
    const squad = G.squad;
    zb.spawnHorde({ kind: 'test', cx: G.x, w: 1, d: 1, count: 200, hp: 1 }, G.z - 0.3);
    for (let i = 0; i < 300; i++) zb.step(1 / 60);
    check('after win: no game over, squad untouched, win not repeated', counts.gameOver === 0 && G.phase === 'win' && G.squad === squad && counts.win === 1, `${counts.gameOver}/${G.phase}/${G.squad}/${squad}/${counts.win}`);
  }
  {
    // squad wiped while the boss corpse is still falling (boss dead, minions alive) must not flip a won fight into a loss
    reset(); zb.prepare(1); zb.start();
    G.squad = 5; G.weapon = 3; zb.syncSoldiers(); G.shield = 0;
    G.z = -G.L + 2;
    let guard = 0;
    while (!(G.boss && !G.boss.alive) && guard++ < 6000) { G.shield = 1e9; zb.step(1 / 60); }
    G.shield = 0;
    zb.spawnHorde({ kind: 'test', cx: G.x, w: 1, d: 1, count: 300, hp: 1 }, G.z - 0.3);
    for (let i = 0; i < 200; i++) zb.step(1 / 60);
    check('boss already dead: stray zombies cannot cause a game over', counts.gameOver === 0 && G.phase === 'win', `${counts.gameOver}/${G.phase}`);
  }
  // ---------------------------------------------------------------- 4. retry / next resets everything, layout is seeded
  {
    zb.prepare(2);
    const sigA = sig();
    zb.start();
    G.squad = 20; G.weapon = 3; zb.syncSoldiers();
    const hero = G.events.find(e => e.type === 'hero');
    zb.activateHero(hero);
    G.z = -G.L + 2;
    for (let i = 0; i < 400; i++) { G.shield = Math.max(G.shield, 1); zb.step(1 / 60); }     // boss, bullets, particles, pops
    check('messy run really produced state to clean (bullets/pops/mech/boss)', zb.stats().bullets + zb.pops.length > 0 && G.mech && G.boss, JSON.stringify(zb.stats()) + ' pops ' + zb.pops.length);
    zb.prepare(2);
    check('retry: same stage = identical bridge layout', sig() === sigA);
    const st = zb.stats();
    check('retry: bullets, particles, pops cleared', st.bullets === 0 && st.particles === 0 && zb.pops.length === 0 && document.querySelectorAll('.pop').length === 0, JSON.stringify(st));
    check('retry: shield, mech, boss, safe flag cleared', G.shield === 0 && G.mech === null && G.boss === null && G.safe === false && document.getElementById('bossbar').hidden);
    check('retry: score/time/weapon/squad reset', G.kills === 0 && G.time === 0 && G.weapon === 0 && G.squad === zb.TUNE.startSquad && G.soldiers.length === Math.min(G.squad, 40) && G.phase === 'menu', `${G.kills} ${G.time} ${G.weapon} ${G.squad}`);
    check('retry: z/x reset', G.z === 0 && G.x === 0 && G.tx === 0);
    check('retry: all events are fresh', G.events.every(e => !e.used && !e.taken && !e.done && !e.missed && !e.hits && !e.charge && !e.fade), '');
    check('retry: only opening hordes exist', Z.every(z => z.dying <= 0 && z.hp > 0) && Z.length < 200, Z.length);
    const stats2 = zb.stats();
    zb.start();
    for (let i = 0; i < 5; i++) zb.step(1 / 60);
    check('retry: runs fine right after reset (stale target buckets are gone)', G.phase === 'run', G.phase);
    zb.prepare(3);
    check('next stage: new layout, stage 3 numbers', G.level === 3 && sig() !== sigA);
  }
  // ---------------------------------------------------------------- 5. gates when the squad sits on the centre line
  {
    zb.prepare(1); zb.start();
    const mk = (side, val, kind) => ({ side, val, kind: kind || 'add' });
    const place = xs => { G.squad = xs.length; zb.syncSoldiers(); xs.forEach((x, i) => { G.soldiers[i].x = x; }); };
    place([0]);
    check('centre line, one soldier, pair +3/-2: the worse gate applies (no free skip)', zb.pickGate(mk(1, 3), mk(-1, -2)).val === -2);
    check('centre line, lone positive gate: nothing happens', zb.pickGate(mk(1, 3), null) === null);
    check('centre line, lone negative gate: it applies', zb.pickGate(mk(-1, -2), null).val === -2);
    place([-1, 0.5, 0.56]);
    check('near centre, more soldiers on the right: right gate', zb.pickGate(mk(-1, 5), mk(1, -1)).side === 1 && zb.squadSide() === 1);
    place([-1.2, -0.9, 2.3]);
    check('mean x +0.07 -> right side', zb.squadSide() === 1);
    place([-1.4, -1.0]);
    check('squad on the left -> left gate', zb.pickGate(mk(1, 4), mk(-1, -4)).side === -1);
    place([0, 0]);
    check('two soldiers exactly centred: tie, worse gate', zb.pickGate(mk(1, 4), mk(-1, -4)).val === -4 && zb.squadSide() === 0);
    place([0.04]); check('single soldier at +0.04 (inside the dead zone, nobody on the left): right', zb.squadSide() === 1);
  }
  // ---------------------------------------------------------------- 6. killSoldier while iterating
  {
    reset(); zb.prepare(3); zb.start();
    G.squad = 40; G.weapon = 0; zb.syncSoldiers(); G.shield = 0;
    let bad = null, steps = 0;
    for (let wave = 0; wave < 12 && G.phase === 'run'; wave++) {
      zb.spawnHorde({ kind: 'test', cx: G.x, w: 6, d: 2, count: 150, hp: 1 }, G.z - 3);
      for (let i = 0; i < 40 && G.phase === 'run'; i++) {
        zb.step(1 / 60); steps++;
        if (G.soldiers.length !== Math.min(G.squad, 40) && G.phase === 'run') bad = `soldiers ${G.soldiers.length} vs squad ${G.squad} (step ${steps})`;
        for (const s of G.soldiers) if (!(isFinite(s.x) && isFinite(s.z))) bad = 'NaN soldier';
      }
    }
    check('heavy contact: soldier list always matches the squad count, no NaN', bad === null, bad);
    check('heavy contact: squad shrank under contact (test is meaningful) and contacts were reported', G.squad < 40 && counts.contact > 0, `${G.squad} / ${counts.contact} contacts`);
    check('heavy contact: game over fired at most once', counts.gameOver <= 1, counts.gameOver);
  }
  // ---------------------------------------------------------------- 7. pool limits
  {
    zb.prepare(3); zb.start();
    G.squad = 40; G.weapon = 3; zb.syncSoldiers(); G.shield = 1e9;
    for (let k = 0; k < 8; k++) zb.spawnHorde({ kind: 'test', cx: 0, w: 7, d: 40, count: 1000, hp: 30 }, G.z - 5 - k);
    check('zombie pool capped at 900', Z.length === 900, Z.length);
    for (let i = 0; i < 240; i++) { G.shield = 1e9; zb.step(1 / 60); if (i % 30 === 0) zb.render(1 / 60); }
    for (let i = 0; i < 5000; i++) zb.spawnBullet(0, G.z - 3, 0, -1, 1, 0);
    check('bullet pool capped at 700', zb.stats().bullets === 700, zb.stats().bullets);
    for (let i = 0; i < 120; i++) { G.shield = 1e9; zb.step(1 / 60); if (i % 20 === 0) zb.render(1 / 60); }
    const st = zb.stats();
    check('particle pool capped at 1400, still running', st.particles <= 1400 && st.bullets <= 700 && Z.length <= 900, JSON.stringify(st));
    check('pools degrade without breaking the run', G.phase === 'run' && G.soldiers.length === 40);
  }
  return out;
});

let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok || !r.detail ? '' : '   [' + r.detail + ']'}`);
}
console.log(`\n${results.length - failed}/${results.length} checks passed; page errors: ${errors.length}`);
if (errors.length) console.log(errors.slice(0, 10).join('\n'));
await browser.close();
process.exit(failed || errors.length ? 1 : 0);
