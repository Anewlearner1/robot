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
  // Teleport to the bridge end. Gates the squad jumps over are marked used, otherwise the first step would "pass" them
  // all at once from the centre line (worse-gate rule) and a random gate value could wipe the squad before the boss.
  const skipToBoss = () => { for (const e of G.events) { if (e.type === 'gate') e.used = true; else if (e.type === 'weapon') e.taken = true; } G.z = -G.L + 2; };   // (round 7: a gun row can sit right at the end of a longer level - mark them taken too)
  const reset = () => { counts.gameOver = counts.win = counts.bossDied = counts.contact = 0; };
  const sig = () => JSON.stringify(G.events.map(e => [e.type, +e.z.toFixed(3), +(e.x || 0).toFixed(3), e.side || 0, e.val || 0, e.kind || '', e.tier || 0, e.need || 0, e.pair, e.spec ? [e.spec.kind, e.spec.count, +e.spec.hp.toFixed(3), +e.spec.cx.toFixed(3)] : 0]));
  const now0 = () => performance.now();

  // ---------------------------------------------------------------- 1. fixed timestep
  for (const fps of [30, 60, 120, 144, 20]) {
    const t0 = now0();
    window.__raf(t0);                                   // sets the frame clock first: the first measured frame must not carry the real time spent since the last section
    zb.prepare(1); zb.start();
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
    skipToBoss();
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
    skipToBoss();
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
    skipToBoss();
    for (let i = 0; i < 400; i++) { G.shield = Math.max(G.shield, 1); zb.step(1 / 60); }     // boss, bullets, particles, pops
    check('messy run really produced state to clean (bullets/pops/mech/boss)', zb.stats().bullets + zb.pops.length > 0 && G.mech && G.boss, JSON.stringify(zb.stats()) + ' pops ' + zb.pops.length);
    zb.prepare(2);
    check('retry: same stage = identical bridge layout', sig() === sigA);
    const st = zb.stats();
    check('retry: bullets, particles, pops cleared', st.bullets === 0 && st.particles === 0 && zb.pops.length === 0 && document.querySelectorAll('.pop').length === 0, JSON.stringify(st));
    check('retry: shield, mech, boss, safe flag cleared', G.shield === 0 && G.mech === null && G.boss === null && G.safe === false && document.getElementById('bossbar').hidden);
    check('retry: score/time/weapon/squad reset', G.kills === 0 && G.time === 0 && G.weapon === 0 && G.squad === zb.entryFor(G.level) && G.soldiers.length === Math.min(G.squad, 40) && G.phase === 'menu', `${G.kills} ${G.time} ${G.weapon} ${G.squad}`);
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
      zb.spawnHorde({ kind: 'test', cx: G.x, w: 6, d: 2, count: 150, hp: 6 }, G.z - 3);
      for (let i = 0; i < 40 && G.phase === 'run'; i++) {
        zb.step(1 / 60); steps++;
        if (G.soldiers.length !== Math.min(G.squad, zb.TUNE.maxSquad) && G.phase === 'run') bad = `soldiers ${G.soldiers.length} vs squad ${G.squad} (step ${steps})`;
        for (const s of G.soldiers) if (!(isFinite(s.x) && isFinite(s.z))) bad = 'NaN soldier';
      }
    }
    check('heavy contact: soldier list always matches the squad count, no NaN', bad === null, bad);
    check('heavy contact: squad shrank under contact (test is meaningful) and contacts were reported', counts.contact > 0 && G.squad < 40 + 12, `${G.squad} / ${counts.contact} contacts`);
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
    check('bullet pool capped at 1200', zb.stats().bullets === 1200, zb.stats().bullets);
    for (let i = 0; i < 120; i++) { G.shield = 1e9; zb.step(1 / 60); if (i % 20 === 0) zb.render(1 / 60); }
    const st = zb.stats();
    check('particle pool capped at 1400, still running', st.particles <= 1400 && st.bullets <= 1200 && Z.length <= 900, JSON.stringify(st));
    check('pools degrade without breaking the run', G.phase === 'run' && G.soldiers.length === 40);
  }
  // ---------------------------------------------------------------- 8. guns: pickups, levels, swap, pairs
  {
    const W = zb.WEAPONS;
    const pick = (e, w, lv) => {                       // stand on pickup e holding gun w at level lv, step once
      G.weapon = w; G.weaponLv = lv;
      G.z = e.z + 0.3; G.x = G.tx = e.x;
      const got = [];
      const h = d => got.push(d);
      zb.bus.on('weaponPickup', h);
      zb.step(1 / 60);
      zb.bus.map.weaponPickup.splice(zb.bus.map.weaponPickup.indexOf(h), 1);
      return got;
    };
    const fresh = stage => { zb.prepare(stage); zb.start(); G.squad = 1; zb.syncSoldiers(); G.shield = 1e9; for (const e of G.events) if (e.type === 'gate') e.used = true; };
    check('roster has 7 guns with the contract fields', W.length === 7 && W.every(g => ['id', 'name', 'fx', 'rate', 'pellets', 'spread', 'dmg', 'speed', 'range', 'pierce', 'splash', 'knock', 'bossEff', 'lvMul', 'maxLv', 'ui'].every(k => k in g)));
    fresh(1);
    const rifle = G.events.find(e => e.type === 'weapon' && e.w === 1);
    const sqL = G.squad;
    let got = pick(rifle, 1, 1);
    check('level up: picking up the gun you hold raises its level, flags upgrade and brings recruits', G.squad === sqL + zb.TUNE.crateRecruits && G.weaponLv === 2 && got.length === 1 && got[0].upgrade === true && got[0].lv === 2 && got[0].w === 1, JSON.stringify(got.map(g => [g.w, g.lv, g.upgrade])));
    fresh(1);
    const rifle2 = G.events.find(e => e.type === 'weapon' && e.w === 1);
    const sq0 = G.squad;
    got = pick(rifle2, 1, W[1].maxLv);
    check('max level: no further level, no upgrade flag, the crate still brings its recruits', G.weaponLv === W[1].maxLv && got[0].upgrade === false && G.squad === sq0 + zb.TUNE.crateRecruits && got[0].recruits === zb.TUNE.crateRecruits, `${G.weaponLv} ${G.squad}`);
    fresh(1);
    const rifle3 = G.events.find(e => e.type === 'weapon' && e.w === 1);
    got = pick(rifle3, 0, 3);
    check('swap: a different gun replaces yours at Lv1, no upgrade flag', G.weapon === 1 && G.weaponLv === 1 && got[0].upgrade === false && got[0].lv === 1, `${G.weapon} ${G.weaponLv}`);
    // level damage: a Lv2 gun fires lvMul times the damage
    fresh(1);
    G.weapon = 1; G.weaponLv = 1; G.soldiers[0].cd = 0;
    const before = zb.stats().bullets;
    zb.step(1 / 60);
    check('a soldier fires the held gun (bullet tagged with its weapon index)', zb.stats().bullets > before && zb.stats().bw.every(w => w === 1), JSON.stringify(zb.stats().bw));
    // pairs: take one, the other disappears
    fresh(1);
    const pairA = G.events.find(e => e.type === 'weapon' && e.mate);
    got = pick(pairA, 1, 1);
    check('pair: taking one gun removes its mate', pairA.taken && pairA.mate.taken && !pairA.mate.grp.visible && G.weapon === pairA.w, `${G.weapon} ${pairA.w}`);
    check('pair: the two guns are side by side (<= 2 in a row) and different', pairA.mate.mate === pairA && pairA.w !== pairA.mate.w && Math.abs(pairA.x - pairA.mate.x) >= 2.5 && G.events.filter(e => e.type === 'weapon' && e.z === pairA.z).length === 2);
    // coverage: every gun is offered somewhere in stages 1-3
    const seen = new Set();
    for (const st of [1, 2, 3]) { zb.prepare(st); for (const e of G.events) if (e.type === 'weapon') seen.add(e.w); }
    check('every gun appears as a pickup across stages 1-3', seen.size === 7, [...seen].sort().join(','));
  }
  // ---------------------------------------------------------------- 9. bullets: pierce, splash, knock, bw bookkeeping
  const critKeep = zb.TUNE.critBase; zb.TUNE.critBase = 0;           // crits would make the exact damage sums below random
  {
    const W = zb.WEAPONS;
    const lab = () => {                                 // a quiet stage: nothing spawns, the lone soldier never fires, the squad stands still
      const keep = zb.TUNE.count.open; zb.TUNE.count.open = 0;
      zb.prepare(1); zb.start();
      zb.TUNE.count.open = keep;
      for (const e of G.events) { if (e.type === 'horde') e.spawned = true; else if (e.type === 'gate') e.used = true; else if (e.type === 'weapon') e.taken = true; else if (e.type === 'hero') e.missed = true; }
      G.phase = 'boss'; G.squad = 1; zb.syncSoldiers(); G.shield = 1e9;
      for (const s of G.soldiers) s.cd = 1e9;
    };
    const mk = (x, z, hp) => { zb.spawnHorde({ kind: 'lab', cx: x, w: 0, d: 0, count: 1, hp }, z); const zb_ = Z[Z.length - 1]; zb_.x = x; zb_.sp = 0; zb_.hp = hp; return zb_; };
    const line = n => { const a = []; for (let i = 0; i < n; i++) a.push(mk(0, -4 - i * 1.0, 100)); return a; };
    const hitCount = (a, dmg) => a.filter(q => q.hp < 100).length;
    const doubles = (a, dmg) => a.filter(q => 100 - q.hp > dmg + 1e-6).length;

    lab(); let zs = line(12);
    zb.spawnBullet(0, -1, 0, -1, 7, 0, 4);              // sniper: pierce 5 -> 6 zombies
    for (let i = 0; i < 40; i++) zb.step(1 / 60);
    check(`pierce: a sniper shot (pierce ${W[4].pierce}) hits exactly pierce+1 zombies, none twice`, hitCount(zs) === W[4].pierce + 1 && doubles(zs, 7) === 0, `hit ${hitCount(zs)}, doubled ${doubles(zs, 7)}`);
    check('pierce: it hits the first ones in line, the rest stay untouched', zs.slice(0, 6).every(q => q.hp < 100) && zs.slice(6).every(q => q.hp === 100));
    lab(); zs = line(12);
    zb.spawnBullet(0, -1, 0, -1, 7, 0, 0);              // pistol: no pierce
    for (let i = 0; i < 40; i++) zb.step(1 / 60);
    check('no pierce: a pistol bullet stops at the first zombie', hitCount(zs) === 1 && zs[0].hp === 93, `hit ${hitCount(zs)}`);
    lab(); zs = line(12);
    zb.spawnBullet(0, -1, 0, -1, 7, 0, 5);              // flamer: pierce 3, short reach
    for (let i = 0; i < 60; i++) zb.step(1 / 60);
    check(`flame: pierce ${W[5].pierce} -> ${W[5].pierce + 1} zombies, never beyond its reach`, hitCount(zs) === W[5].pierce + 1 && doubles(zs, 7) === 0, `hit ${hitCount(zs)}`);
    lab(); zs = line(4);
    for (let k = 0; k < 20; k++) zb.spawnBullet(0, -1, 0, -1, 1, 0, 4);   // many piercing bullets at once: still no double hit per bullet
    for (let i = 0; i < 40; i++) zb.step(1 / 60);
    check('pierce: 20 sniper bullets through 4 zombies = exactly 20 hits each (no double counting)', zs.every(q => Math.abs(q.hp - 80) < 1e-6), zs.map(q => q.hp).join(','));

    lab();
    const tgt = mk(0, -6, 100), near = mk(1.0, -6.2, 100), far = mk(3.2, -6, 100);
    let exploded = [];
    const eh = d => exploded.push(d);
    zb.bus.on('explode', eh);
    zb.spawnBullet(0, -1, 0, -1, 4, 0, 6, 0, 0, -6);   // rocket (lob): splash 1.6, lands on the target at z = -6
    for (let i = 0; i < 60; i++) zb.step(1 / 60);
    zb.bus.map.explode.splice(zb.bus.map.explode.indexOf(eh), 1);
    const sp = zb.TUNE.splashDmg;
    check('splash: the target takes full + blast damage, a neighbour inside the radius takes the blast, one outside takes nothing', tgt.hp <= 100 - 4 && near.hp < 100 && near.hp >= 100 - 4 * sp - 1e-6 && far.hp === 100, `${tgt.hp} ${near.hp} ${far.hp}`);
    check('splash: exactly one explode event, with the weapon blast radius', exploded.length === 1 && Math.abs(exploded[0].r - W[6].splash) < 1e-6, JSON.stringify(exploded));
    lab(); const t2 = mk(0, -6, 100), n2 = mk(1.0, -6.2, 100);
    exploded = []; zb.bus.on('explode', eh);
    zb.spawnBullet(0, -1, 0, -1, 4, 0, 1);              // rifle: no splash
    for (let i = 0; i < 60; i++) zb.step(1 / 60);
    zb.bus.map.explode.splice(zb.bus.map.explode.indexOf(eh), 1);
    check('no splash for a plain bullet: neighbour untouched, no explode event', n2.hp === 100 && t2.hp < 100 && exploded.length === 0);

    lab(); const kA = mk(-2, -6, 100), kB = mk(2, -6, 100);
    kA.sp = kB.sp = 1; kA.z = kB.z = -6;
    for (let k = 0; k < 4; k++) zb.spawnBullet(-2, -1, 0, -1, 1, 0, 2);   // shotgun pellets: knock
    zb.spawnBullet(2, -1, 0, -1, 1, 0, 1);              // rifle bullet: none
    for (let i = 0; i < 12; i++) zb.step(1 / 60);
    check('knock: a shotgun pellet sets a back-push on the zombie, a rifle bullet does not', kA.kv > 0 && kB.kv === 0 && kA.kv <= zb.TUNE.knockMax + 1e-9, `${kA.kv} ${kB.kv}`);
    const zA = kA.z, zB = kB.z;
    for (let i = 0; i < 90; i++) zb.step(1 / 60);
    check('knock: the pushed zombie ends up further down the bridge than the unpushed one, and the push dies out', (kB.z - zB) > (kA.z - zA) + 0.05 && kA.kv === 0, `${(kA.z - zA).toFixed(2)} vs ${(kB.z - zB).toFixed(2)}`);

    // bw stays right while removeBullet swaps the last bullet into the freed slot
    lab();
    const order = [4, 2, 6, 1, 5, 3, 0];
    for (const w of order) zb.spawnBullet(3.9, -1, 0, -1, 1, 0, w);   // along the rail: no targets, they just expire
    check('bw: spawn order recorded', JSON.stringify(zb.stats().bw) === JSON.stringify(order), JSON.stringify(zb.stats().bw));
    let ok = true, why = '';
    for (let i = 0; i < 90; i++) {
      zb.step(1 / 60);
      const st = zb.stats();
      for (let k = 0; k < st.bw.length; k++) if (st.bl[k] > W[st.bw[k]].range + 1e-6) { ok = false; why = `slot ${k} gun ${st.bw[k]} life ${st.bl[k]} > range ${W[st.bw[k]].range}`; }
    }
    check('bw: every surviving bullet keeps its own gun index (life never exceeds that gun\'s range)', ok, why);
    check('bullets expire by their gun\'s range', zb.stats().bullets === 0, JSON.stringify(zb.stats().bw));
    lab();
    for (const w of [4, 2, 6, 1]) zb.spawnBullet(0, -1, 0, -1, 1, 0, w);
    for (let i = 0; i < 26; i++) zb.step(1 / 60);       // 0.43 s: sniper (0.18 s) and shotgun (0.4 s) are gone, rocket (0.9 s) and rifle (0.56 s) are not
    const st2 = zb.stats();
    check('bw: after swap-removals exactly the long-lived guns remain', st2.bw.length === 2 && st2.bw.slice().sort().join() === '1,6', JSON.stringify(st2.bw));
    check('bullet life starts at the gun\'s range', (() => { lab(); zb.spawnBullet(3.9, -1, 0, -1, 1, 0, 5); return Math.abs(zb.stats().bl[0] - W[5].range) < 1e-6; })());
  }
  zb.TUNE.critBase = critKeep;
  // ================================================================ round 3: campaign, hazards, gates, rewards
  const KEY = 'zombie-bridge-save';
  const T = zb.TUNE;
  const listen = (name, arr) => { const h = d => arr.push(d); zb.bus.on(name, h); return () => zb.bus.map[name].splice(zb.bus.map[name].indexOf(h), 1); };
  // a quiet lab (as in section 9): nothing spawns, the lone soldier does not fire; barrels and gates of the stage stay as built
  const lab3 = stage => {
    const keep = T.count.open; T.count.open = 0;
    zb.prepare(stage || 1); zb.start();
    T.count.open = keep;
    for (const e of G.events) { if (e.type === 'horde') e.spawned = true; else if (e.type === 'gate') e.used = true; else if (e.type === 'weapon') e.taken = true; else if (e.type === 'hero') e.missed = true; }
    G.phase = 'boss'; G.squad = 1; zb.syncSoldiers(); G.shield = 1e9;
    for (const s of G.soldiers) s.cd = 1e9;
  };
  const mk3 = (x, z, hp) => { zb.spawnHorde({ kind: 'lab', cx: x, w: 0, d: 0, count: 1, hp }, z); const q = Z[Z.length - 1]; q.x = x; q.sp = 0; q.hp = hp; return q; };
  const crit0 = T.critBase;
  T.critBase = 0;
  // plays stage n from its entry squad to a win with `squad` survivors; returns what stageResult / SAVE said
  const playWin = (n, squad) => {
    zb.startStage(n);
    G.squad = squad; G.weapon = 3; zb.syncSoldiers(); G.shield = 1e9;
    skipToBoss();
    const log = [], res = [], seen = [];
    const o1 = listen('stageResult', res), o2 = listen('win', log), o3 = listen('stageResult', seen);
    let coinsAtEvent = null, entryAtEvent = null, runCoins = null, winsBefore = -1;
    const h = () => { winsBefore = log.length; coinsAtEvent = zb.SAVE.coins; runCoins = G.coins; entryAtEvent = zb.SAVE.nodes[zb.mainId(n + 1)] && zb.SAVE.nodes[zb.mainId(n + 1)].entry; };
    zb.bus.on('stageResult', h);
    let guard = 0;
    while (G.phase !== 'win' && guard++ < 8000) { G.shield = 1e9; zb.step(1 / 60); }
    zb.bus.map.stageResult.splice(zb.bus.map.stageResult.indexOf(h), 1);
    o1(); o2(); o3();
    return { r: res[0], n: res.length, wins: log.length, phase: G.phase, coinsAtEvent, entryAtEvent, runCoins, winsBefore, survivors: G.squad };
  };

  // ---------------------------------------------------------------- 10. save, carry-over, stars, coins
  {
    zb.resetSave();
    check('save: a fresh save has no coins, no upgrades, entry 1 for every stage', zb.SAVE.coins === 0 && !zb.SAVE.upgrades.dmg && zb.entryFor(1) === T.startSquad && zb.entryFor(3) === T.startSquad);
    zb.SAVE.coins = 123; zb.SAVE.upgrades.dmg = 2; zb.SAVE.best = 3; zb.SAVE.nodes[zb.mainId(2)] = { entry: 37, stars: 2 };
    zb.saveGame();
    const raw = JSON.parse(localStorage.getItem(KEY));
    check('save: round trip, the stored JSON has coins / upgrades / best / nodes[id].entry+stars', raw.coins === 123 && raw.upgrades.dmg === 2 && raw.best === 3 && raw.nodes.n2.entry === 37 && raw.nodes.n2.stars === 2, JSON.stringify(raw));
    zb.SAVE.coins = 0; zb.SAVE.upgrades = {}; zb.SAVE.nodes = {}; zb.SAVE.best = 1;
    zb.loadSave();
    check('save: loadSave restores the same state', zb.SAVE.coins === 123 && zb.SAVE.upgrades.dmg === 2 && zb.SAVE.best === 3 && zb.entryFor(2) === 37 && zb.SAVE.nodes[zb.mainId(2)].stars === 2, JSON.stringify(zb.SAVE));
    localStorage.setItem(KEY, '{broken json');
    let threw = false; try { zb.loadSave(); } catch (e) { threw = true; }
    check('save: a corrupt save does not throw, falls back to a fresh one', !threw && zb.SAVE.coins === 0 && zb.entryFor(2) === T.startSquad);
    localStorage.setItem(KEY, JSON.stringify({ v: 1, coins: -5, best: 2, upgrades: { dmg: 99 }, stages: { 2: { entry: 9999, stars: 9 } } }));
    zb.loadSave();
    check('save: out-of-range values are clamped', zb.SAVE.coins === 0 && zb.SAVE.upgrades.dmg === zb.UPGRADES[0].max && zb.entryFor(2) === T.maxSquad && zb.SAVE.nodes[zb.mainId(2)].stars === 3, JSON.stringify(zb.SAVE));
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function () { throw new Error('quota'); };
    threw = false; try { zb.saveGame(); } catch (e) { threw = true; }
    Storage.prototype.setItem = setItem;
    check('save: a failing localStorage never throws', !threw);
    // migration from the old single key
    localStorage.removeItem(KEY); localStorage.setItem('zombie-bridge-best', '4');
    zb.loadSave();
    check('migration: the old zombie-bridge-best key unlocks stages up to it with the migrate squad', zb.SAVE.best === 4 && zb.entryFor(2) === T.migrateEntry && zb.entryFor(4) === T.migrateEntry && zb.entryFor(5) === T.startSquad, JSON.stringify(zb.SAVE));
    zb.startStage(3);
    check('migration: starting stage 3 uses the migrated entry squad', G.level === 3 && G.squad === T.migrateEntry && G.phase === 'run', `${G.level} ${G.squad} ${G.phase}`);
    localStorage.removeItem('zombie-bridge-best');
    zb.resetSave();

    // carry-over: startStage(n) starts with SAVE.stages[n].entry; weapon and level reset
    zb.SAVE.nodes[zb.mainId(2)] = { entry: 37, stars: 0 }; zb.saveGame();
    G.weapon = 4; G.weaponLv = 3;
    zb.startStage(2);
    check('carry-over: startStage(2) starts with the stored entry squad, phase run', G.level === 2 && G.phase === 'run' && G.squad === 37 && G.entrySquad === 37 && G.soldiers.length === 37, `${G.level} ${G.squad} ${G.soldiers.length}`);
    check('carry-over: the gun and its level reset every stage', G.weapon === 0 && G.weaponLv === 1 && G.coins === 0 && G.combo === 0 && Object.keys(G.buffs).length === 0);
    zb.prepare(2);
    check('carry-over: prepare(2) alone already shows the entry squad (menu preview)', G.squad === 37 && G.phase === 'menu');

    // a lost run: retry uses the same entry, coins are halved, nothing is carried
    counts.gameOver = 0;
    zb.startStage(2);
    const lost = [], order = [];
    const l1 = listen('stageResult', lost);
    const ho = n => () => order.push(n);
    const oA = ho('stageResult'), oB = ho('gameOver'); zb.bus.on('stageResult', oA); zb.bus.on('gameOver', oB);
    let lossCoins = null; const oC = () => { lossCoins = G.coins; }; zb.bus.on('stageResult', oC);
    G.squad = 3; zb.syncSoldiers(); G.shield = 0; G.coins = 100;
    const wallet0 = zb.SAVE.coins;
    zb.spawnHorde({ kind: 'test', cx: G.x, w: 1, d: 1, count: 400, hp: 1 }, G.z - 0.3);
    for (let i = 0; i < 120; i++) zb.step(1 / 60);
    l1(); zb.bus.map.stageResult.splice(zb.bus.map.stageResult.indexOf(oC), 1); zb.bus.map.stageResult.splice(zb.bus.map.stageResult.indexOf(oA), 1); zb.bus.map.gameOver.splice(zb.bus.map.gameOver.indexOf(oB), 1);
    const lr = lost[0];
    check('loss: exactly one stageResult, before gameOver', lost.length === 1 && order.join() === 'stageResult,gameOver', order.join());
    check('loss: 0 stars, no bonus, coins = half of the run coins, banked in SAVE', lr && lr.stars === 0 && lr.bonus === 0 && lr.coins === Math.floor(lossCoins * T.loseCoinShare) && zb.SAVE.coins === wallet0 + lr.coins, JSON.stringify(lr) + ' wallet ' + zb.SAVE.coins);
    check('loss: the stored entry is untouched', zb.SAVE.nodes[zb.mainId(2)].entry === 37 && zb.SAVE.nodes[zb.mainId(3)] === undefined);
    zb.startStage(2);
    check('retry: the same stage starts with the same entry squad again', G.squad === 37 && G.entrySquad === 37 && G.coins === 0);

    // a won run: survivors become the next entry (the larger is kept), stars, coin payout, SAVE written before stageResult
    zb.resetSave();
    let w = playWin(1, 25);
    check('win: one stageResult (before the win event), one win, phase win', w.n === 1 && w.wins === 1 && w.winsBefore === 0 && w.phase === 'win', `${w.n} ${w.wins} ${w.phase}`);
    check('win: survivors are stored as the entry squad of stage 2 and SAVE was already updated when stageResult fired', zb.SAVE.nodes[zb.mainId(2)].entry === 25 && w.entryAtEvent === 25 && w.r.survivors === 25, `${zb.SAVE.nodes[zb.mainId(2)].entry} ${w.entryAtEvent}`);
    check('win: stage 1 entry 1, 25 survivors = 3 stars; coins = run coins + stars*stage*starCoins, wallet += coins (SAVE updated before the event)', w.r.entry === 1 && w.r.stars === 3 && w.r.bonus === 3 * 1 * T.starCoins && w.r.coins === w.runCoins + w.r.bonus && zb.SAVE.coins === w.r.coins && w.coinsAtEvent === w.r.coins && zb.SAVE.nodes[zb.mainId(1)].stars === 3, JSON.stringify(w.r));
    check('win: best unlocks the next stage', zb.SAVE.best === 2);
    w = playWin(1, 12);
    check('win again with fewer survivors: the larger entry (25) is kept', zb.SAVE.nodes[zb.mainId(2)].entry === 25, zb.SAVE.nodes[zb.mainId(2)].entry);
    // stars: 1 clear, 2 if survivors >= entry, 3 if >= max(1.5 x entry, entry + 10)
    zb.resetSave(); zb.SAVE.nodes[zb.mainId(2)] = { entry: 20, stars: 0 };
    const sv = n => { zb.SAVE.nodes[zb.mainId(2)] = { entry: 20, stars: 0 }; return playWin(2, n).r.stars; };
    const st = [sv(19), sv(20), sv(29), sv(30)];
    check('stars: entry 20 -> 19 survivors 1 star, 20 -> 2, 29 -> 2, 30 -> 3', st.join() === '1,2,2,3', st.join());
    zb.SAVE.nodes[zb.mainId(2)] = { entry: 50, stars: 0 };
    const hi = [playWin(2, 74).r.stars, playWin(2, 75).r.stars, playWin(2, 49).r.stars];
    zb.SAVE.nodes[zb.mainId(2)] = { entry: 94, stars: 0 };
    const top = [playWin(2, 94).r.stars, playWin(2, 95).r.stars];
    check('stars: with an entry of 94 the 3-star bar is 95% of the cap (95 survivors), not an impossible 100+', top.join() === '2,3', top.join());
    zb.SAVE.nodes[zb.mainId(2)] = { entry: 50, stars: 0 };
    check('stars: with the cap at 100 the 3-star bar for entry 50 is 75 survivors (>= 1.5 x entry); below the entry is 1 star', hi.join() === '2,3,1', hi.join());
    zb.resetSave();
  }

  // ---------------------------------------------------------------- 11. upgrades
  {
    zb.resetSave();
    const bought = []; const un = listen('upgradeBought', bought);
    check('upgrade: not enough coins -> false, nothing changes', zb.buyUpgrade('dmg') === false && zb.SAVE.coins === 0 && !zb.SAVE.upgrades.dmg && bought.length === 0);
    check('upgrade: unknown id -> false', zb.buyUpgrade('nope') === false);
    zb.SAVE.coins = 1000;
    const cost = zb.upgradeCost('dmg');
    let rawAtEvent = null; const hh = () => { rawAtEvent = JSON.parse(localStorage.getItem(KEY)); }; zb.bus.on('upgradeBought', hh);
    const ok = zb.buyUpgrade('dmg');
    zb.bus.map.upgradeBought.splice(zb.bus.map.upgradeBought.indexOf(hh), 1);
    check('upgrade: buying takes the cost, raises the level, emits upgradeBought, SAVE written before the event', ok && zb.SAVE.coins === 1000 - cost && zb.SAVE.upgrades.dmg === 1 && bought.length === 1 && bought[0].id === 'dmg' && bought[0].lv === 1 && bought[0].cost === cost && rawAtEvent && rawAtEvent.upgrades.dmg === 1, JSON.stringify(bought));
    check('upgrade: the price grows with the level', zb.upgradeCost('dmg') > cost);
    const max = zb.UPGRADES.find(u => u.id === 'dmg').max;
    zb.SAVE.upgrades.dmg = max; zb.SAVE.coins = 1e6;
    check('upgrade: at the max level -> false, coins untouched', zb.buyUpgrade('dmg') === false && zb.SAVE.coins === 1e6 && zb.SAVE.upgrades.dmg === max);
    un();
    // effect: +per damage per level on every shot
    const shot = lvl => {
      zb.resetSave(); zb.SAVE.upgrades.dmg = lvl;
      lab3(1);
      const t = mk3(0.14, -3, 100); t.s = 1.6;                        // a wide target so the aim spread cannot miss
      G.weapon = 1; G.weaponLv = 1; G.soldiers[0].cd = 0;
      zb.step(1 / 60); G.soldiers[0].cd = 1e9;
      for (let i = 0; i < 30; i++) zb.step(1 / 60);
      return 100 - t.hp;
    };
    const d0 = shot(0), d5 = shot(5);
    check('upgrade: damage level 5 = +5 x per damage on a shot', d0 > 0 && Math.abs(d5 / d0 - (1 + 5 * zb.UPGRADES[0].per)) < 1e-6, `${d0} ${d5}`);
    zb.resetSave();
  }

  // ---------------------------------------------------------------- 12. barrels, exploders, shields
  {
    zb.resetSave();
    // a stage that has barrels
    let barrelStage = 0;
    for (const sNo of [1, 2, 3]) { zb.prepare(sNo); if (zb.levelBarrels.length) { barrelStage = sNo; break; } }
    check('barrel: the seeded stages carry barrels, as events without a mesh', barrelStage > 0 && zb.levelBarrels.every(b => b.type === 'barrel' && b.grp === undefined && b.hp === T.barrelHp && !b.dead && G.events.includes(b)), `stage ${barrelStage}`);
    const barrelsA = JSON.stringify(zb.levelBarrels.map(b => [+b.x.toFixed(3), +b.z.toFixed(3)]));
    zb.prepare(barrelStage);
    check('barrel: seeded, the same stage gives the same barrels', JSON.stringify(zb.levelBarrels.map(b => [+b.x.toFixed(3), +b.z.toFixed(3)])) === barrelsA);

    lab3(barrelStage);
    const b = zb.levelBarrels.find(q => !q.dead);
    G.z = b.z + 10;
    const inside = [], outside = [];
    for (let i = 0; i < 30; i++) inside.push(mk3(b.x + (i % 6) * 0.3 - 0.75, b.z - 0.6 - Math.floor(i / 6) * 0.4, 3.5));       // a dense knot, all inside the blast
    const far = mk3(b.x + T.barrelR + 1.5, b.z, 3.5);
    const ev = [], ex = [];
    const r1 = listen('barrel', ev), r2 = listen('explode', ex);
    const squad0 = G.squad;
    for (let i = 0; i < T.barrelHp; i++) zb.spawnBullet(b.x, b.z + 2, 0, -1, 1, 0, 0);
    for (let i = 0; i < 30; i++) zb.step(1 / 60);
    r1(); r2();
    const hurt = inside.filter(q => q.hp < 3.5);
    check('barrel: enough hits blow it up: dead, one barrel{x,z} event with the blast radius, one explode', b.dead && ev.length === 1 && Math.abs(ev[0].x - b.x) < 1e-6 && Math.abs(ev[0].z - b.z) < 1e-6 && ex.length === 1, `${b.dead} ${ev.length} ${ex.length}`);
    check('barrel: the blast hurts zombies inside the radius (up to barrelCap), each by barrelDmg, and nobody outside', hurt.length > 0 && hurt.length <= T.barrelCap && hurt.every(q => Math.abs(3.5 - q.hp - T.barrelDmg) < 1e-6 || q.dying > 0 || q.hp <= 0) && far.hp === 3.5, `${hurt.length} hurt, far ${far.hp}`);
    check('barrel: the squad is never hurt by a blast', G.squad === squad0 && G.soldiers.length === squad0);
    // a barrel standing on the squad
    lab3(barrelStage);
    const b2 = zb.levelBarrels.find(q => !q.dead);
    G.z = b2.z + 10; G.x = G.tx = b2.x;
    for (const s of G.soldiers) { s.x = b2.x; s.z = b2.z; }
    const sq1 = G.squad;
    for (let i = 0; i < T.barrelHp; i++) zb.spawnBullet(b2.x, b2.z + 0.5, 0, -1, 1, 0, 0);
    for (let i = 0; i < 20; i++) zb.step(1 / 60);
    check('barrel: blowing one up right on top of the squad costs no soldier', b2.dead && G.squad === sq1 && G.phase !== 'over', `${b2.dead} ${G.squad}`);

    // flags on the special zombies
    zb.spawnHorde({ kind: 'flags', cx: 0, w: 0, d: 0, count: 1, hp: 3, exFrac: 1, shFrac: 0 }, -40);
    const zE = Z[Z.length - 1];
    zb.spawnHorde({ kind: 'flags', cx: 0, w: 0, d: 0, count: 1, hp: 3, exFrac: 1e-9, shFrac: 1 }, -40);
    const zS = Z[Z.length - 1];
    check('zombie flags: zb.ex for exploders, zb.sh for shield zombies (zb.ek is the same as a string)', zE.ex === true && zE.sh === false && zE.ek === 'exploder' && zS.sh === true && zS.ex === false && zS.ek === 'shield' && zS.shHp === T.shieldBreak && !Z.slice(0, -2).some(q => q.sh || q.ex) , `${zE.ek} ${zS.ek}`);

    // exploder chain
    lab3(1);
    const row = [];
    for (let i = 0; i < 6; i++) { const q = mk3(0, -6 - i * 1.0, 2); q.ek = 'exploder'; q.ex = true; row.push(q); }
    const bystander = mk3(0, -6 - 6 * 1.0 - 3, 3); bystander.hp = 3;
    const ch = []; const c1 = listen('chain', ch);
    zb.spawnBullet(0, -1, 0, -1, 3, 0, 0);
    for (let i = 0; i < 40; i++) zb.step(1 / 60);
    c1();
    check('exploder chain: shooting the first sets off the whole row, one chain{n} event with n = the chain kills', row.every(q => q.hp <= 0) && ch.length === 1 && ch[0].n === 5, `${row.map(q => q.hp).join()} chain ${JSON.stringify(ch)}`);
    check('exploder chain: a zombie out of reach is not hurt', bystander.hp === 3);

    // shields
    const blockRun = (w, dx, dz, x0, z0) => {
      lab3(1);
      const sh = mk3(0, -6, 100); sh.ek = 'shield'; sh.sh = true; sh.shHp = T.shieldBreak;
      const behind = mk3(0, -7, 100);
      const blocks = []; const k = listen('shieldBlock', blocks);
      zb.spawnBullet(x0, z0, dx, dz, 7, 0, w, 0, 0, -6);
      for (let i = 0; i < 50; i++) zb.step(1 / 60);
      k();
      return { sh, behind, blocks };
    };
    let s = blockRun(0, 0, -1, 0, -1);
    check('shield: a plain pistol bullet from the front is blocked: neither zombie is hurt, shieldBlock fires', s.sh.hp === 100 && s.behind.hp === 100 && s.blocks.length === 1, `${s.sh.hp} ${s.behind.hp} ${s.blocks.length}`);
    s = blockRun(4, 0, -1, 0, -1);
    check('shield: a piercing sniper shot goes through the shield (both hurt), no block', s.sh.hp < 100 && s.behind.hp < 100 && s.blocks.length === 0);
    s = blockRun(5, 0, -1, 0, -1);
    check('shield: flame (pierce) goes through as well', s.sh.hp < 100 && s.blocks.length === 0);
    s = blockRun(6, 0, -1, 0, -1);
    check('shield: rocket splash hurts the shield zombie (and the one behind it)', s.sh.hp < 100 && s.behind.hp < 100 && s.blocks.length === 0);
    s = blockRun(0, 0.8, -0.6, -3.2, -3.6);
    check('shield: a plain bullet from the flank gets through', s.sh.hp < 100 && s.blocks.length === 0, `${s.sh.hp}`);
    {
      lab3(1);
      const sh = mk3(0, -6, 100); sh.ek = 'shield'; sh.sh = true; sh.shHp = T.shieldBreak;
      const br = []; const k = listen('shieldBreak', br);
      for (let i = 0; i < T.shieldBreak; i++) zb.spawnBullet(0, -1 - i * 0.01, 0, -1, 7, 0, 0);
      for (let i = 0; i < 40; i++) zb.step(1 / 60);
      const hpBlocked = sh.hp;
      zb.spawnBullet(0, -1, 0, -1, 7, 0, 0);
      for (let i = 0; i < 40; i++) zb.step(1 / 60);
      k();
      check('shield: it breaks after shieldBreak blocks (zb.sh false, shieldBreak event) and the next bullet hurts', hpBlocked === 100 && sh.sh === false && br.length === 1 && sh.hp < 100, `${hpBlocked} ${sh.sh} ${br.length} ${sh.hp}`);
    }
    {
      lab3(1);
      const shs = [];
      for (let i = 0; i < 12; i++) { const q = mk3(-3.3 + i * 0.6, -6, 100); q.ek = 'shield'; q.sh = true; q.shHp = T.shieldBreak; shs.push(q); }
      const blocks = []; const k = listen('shieldBlock', blocks);
      for (let i = 0; i < 12; i++) zb.spawnBullet(-3.3 + i * 0.6, -1, 0, -1, 7, 0, 0);
      for (let i = 0; i < 60; i++) zb.step(1 / 60);
      k();
      check('shield: shieldBlock is throttled to at most 10 a second (12 blocks in a burst -> a couple of events)', blocks.length >= 1 && blocks.length <= 3 && shs.every(q => q.hp === 100), `${blocks.length}`);
    }
  }

  // ---------------------------------------------------------------- 13. gate kinds
  {
    zb.resetSave();
    // find, over the seeded stages, a gate of each special kind
    const find = kind => { for (let sNo = 1; sNo <= 14; sNo++) { zb.prepare(sNo); const g = G.events.find(e => e.type === "gate" && e.kind === kind); if (g) return sNo; } return 0; };
    const sR = find('rate'), sL = find('level'), sM = find('mystery');
    check('gates: the seeded stages contain rate, level and mystery gates', sR > 0 && sL > 0 && sM > 0, `${sR} ${sL} ${sM}`);
    const passIt = (stage, kind, setup) => {
      zb.prepare(stage); zb.start();
      const g = G.events.find(e => e.type === 'gate' && e.kind === kind);
      for (const e of G.events) if (e.type === 'gate' && e !== g && e.pair !== g.pair) e.used = true;
      G.shield = 1e9; G.squad = 10; zb.syncSoldiers();
      if (setup) setup();
      for (const s of G.soldiers) s.x = g.side * 2;                   // the squad stands on the gate's side
      G.x = G.tx = g.side * 2;
      G.z = g.z + 0.05;
      const passes = [], rev = []; const a = listen('gatePass', passes), c = listen('gateReveal', rev);
      const rate0 = G.rateBonus, lv0 = G.weaponLv, sq0 = G.squad;
      zb.step(1 / 60);
      a(); c();
      return { g, passes, rev, rate0, lv0, sq0 };
    };
    let p = passIt(sR, 'rate');
    check('gate rate: +20 % fire rate, e.val = 20, gatePass fires with diff 0', p.g.val === T.rateGate && Math.abs(G.rateBonus - p.rate0 - T.rateGate / 100) < 1e-9 && p.passes.length === 1 && p.passes[0].diff === 0 && G.squad === p.sq0, `${p.g.val} ${G.rateBonus}`);
    p = passIt(sL, 'level', () => { G.weapon = 1; G.weaponLv = 1; });
    check('gate level: +1 weapon level, gatePass fires', G.weaponLv === 2 && p.passes.length === 1 && p.g.val === 1, `${G.weaponLv}`);
    p = passIt(sL, 'level', () => { G.weapon = 1; G.weaponLv = 3; });
    check('gate level on a maxed gun: recruits instead', G.weaponLv === 3 && G.squad === p.sq0 + T.levelGateRecruits, `${G.squad}`);
    p = passIt(sM, 'mystery');
    check('gate mystery: passing it reveals it first (gateReveal{e,val,kind}) and then it acts as the revealed kind', p.rev.length === 1 && p.rev[0].e === p.g && p.rev[0].kind === p.g.kind && p.rev[0].kind !== 'mystery' && p.rev[0].val === p.g.val && p.g.revealed === true && p.passes.length === 1, JSON.stringify([p.rev.length, p.g.kind, p.g.val]));
    // shooting a ? gate reveals it too
    lab3(sM);
    const mg = G.events.find(e => e.type === 'gate' && e.kind === 'mystery');
    mg.used = false;
    G.z = mg.z + 12; G.x = G.tx = mg.x;
    const rev2 = []; const c2 = listen('gateReveal', rev2);
    const hits = []; const c3 = listen('gateHit', hits);
    for (let i = 0; i < T.mysteryHits + 4; i++) zb.spawnBullet(mg.x, mg.z + 2, 0, -1, 1, 0, 0);
    for (let i = 0; i < 40; i++) zb.step(1 / 60);
    c2(); c3();
    check('gate mystery: enough shots reveal it (once), the gate is still unused', rev2.length === 1 && mg.kind !== 'mystery' && !mg.used && hits.length > 0, `${rev2.length} ${mg.kind}`);
    // the extras never move the base layout: a stage's hordes / weapons are the same whether or not specials exist
    const baseSig = () => JSON.stringify(G.events.filter(e => e.type === 'horde' || e.type === 'weapon' || e.type === 'hero').map(e => [e.type, +e.z.toFixed(3), e.spec ? [e.spec.kind, e.spec.count] : e.w]));
    zb.prepare(2); const a1 = baseSig();
    const keepB = T.barrelChance, keepS = T.specialGate;
    T.barrelChance = 0; T.specialGate = 0; zb.prepare(2); const a2 = baseSig();
    T.barrelChance = keepB; T.specialGate = keepS;
    check('layout: switching barrels and special gates off leaves hordes, guns and batteries exactly where they were (second seeded stream)', a1 === a2);
  }

  // ---------------------------------------------------------------- 14. combo, coins, buffs, drops, crits, squad milestones
  {
    zb.resetSave();
    const killOne = () => { const q = mk3(0, -4, 1); zb.spawnBullet(0, -1, 0, -1, 1, 0, 1); for (let i = 0; i < 12; i++) zb.step(1 / 60); return q; };
    lab3(1); G.z = 0;
    const cb = [], ms = [], ce = [], bs = [], be = [];
    const u = [listen('combo', cb), listen('comboMilestone', ms), listen('comboEnd', ce), listen('buffStart', bs), listen('buffEnd', be)];
    G.combo = 24; G.comboT = 1; killOne();
    check('combo: every kill counts (combo{n}), milestone 25 pays coins and has no buff', cb.length === 1 && cb[0].n === 25 && ms.length === 1 && ms[0].n === 25 && ms[0].reward.coins > 0 && !ms[0].reward.buff && bs.length === 0, JSON.stringify(ms));
    check('combo: the milestone coins are in G.coins', G.coins >= ms[0].reward.coins);
    G.combo = 99; G.comboT = 1; killOne();
    const m100 = ms.find(m => m.n === 100);
    check('combo: 100 pays more and starts frenzy (reward.buff, buffStart, G.buffs.frenzy = seconds left)', m100 && m100.reward.buff === 'frenzy' && bs.length === 1 && bs[0].id === 'frenzy' && G.buffs.frenzy > 0 && G.buffs.frenzy <= T.comboFrenzy + 1e-6, JSON.stringify(m100) + JSON.stringify(G.buffs));
    for (let i = 0; i < 60 * (T.comboFrenzy + 1); i++) zb.step(1 / 60);
    check('buff: it runs out (buffEnd once, G.buffs entry gone)', be.length === 1 && be[0].id === 'frenzy' && G.buffs.frenzy === undefined, JSON.stringify(be));
    check('combo: it ends after the window with no kill (comboEnd{n}), G.combo back to 0', ce.length >= 1 && ce[ce.length - 1].n >= 100 && G.combo === 0, JSON.stringify(ce));
    G.combo = 49; G.comboT = 1; killOne(); G.combo = 199; G.comboT = 1; killOne();
    check('combo: milestones 50 and 200 fire as well, in order', ms.map(m => m.n).join() === '25,100,50,200', ms.map(m => m.n).join());
    u.forEach(f => f());

    // coins from a brute: immediate integer payout, coin event
    lab3(1); G.z = 0;
    const co = []; const k1 = listen('coin', co);
    const g0 = G.coins;
    const brute = mk3(0, -4, 1); brute.big = true;
    zb.spawnBullet(0, -1, 0, -1, 1, 0, 1);
    for (let i = 0; i < 12; i++) zb.step(1 / 60);
    k1();
    check('coins: a brute pays at once, an integer, with a coin{x,z,amount} event; G.coins is always an integer', G.coins > g0 && Number.isInteger(G.coins) && co.length >= 1 && co.every(c => Number.isInteger(c.amount) && c.amount >= 1) && co[0].x !== undefined && co[0].z !== undefined, JSON.stringify(co));

    // power-up drops: a brute kill drops an orb event (no mesh), the squad walks into it
    lab3(1); G.z = 0;
    const keepD = T.dropBrute; T.dropBrute = 1;
    const dr = [], pu = [], bs2 = [], be2 = [];
    const k2 = [listen('drop', dr), listen('powerup', pu), listen('buffStart', bs2), listen('buffEnd', be2)];
    const br2 = mk3(0, -4, 1); br2.big = true;
    zb.spawnBullet(0, -1, 0, -1, 1, 0, 1);
    for (let i = 0; i < 12; i++) zb.step(1 / 60);
    T.dropBrute = keepD;
    const orb = G.events.find(e => e.type === 'powerup');
    check('drop: a brute kill leaves a powerup event {type, id, x, z} with no mesh, plus a drop{x,z,id} bus event', orb && (orb.id === 'frenzy' || orb.id === 'split') && orb.grp === undefined && orb.taken === false && dr.length === 1 && dr[0].id === orb.id, JSON.stringify(dr));
    orb.x = G.x; orb.z = G.z + 0.5;
    zb.step(1 / 60);
    const secs = orb.id === 'frenzy' ? T.frenzySecs : T.splitSecs;
    check('drop: walking into it picks it up (powerup{id}, taken, buffStart, G.buffs[id] = seconds left)', orb.taken === true && pu.length === 1 && pu[0].id === orb.id && bs2.length === 1 && G.buffs[orb.id] > secs - 0.1 && G.buffs[orb.id] <= secs, JSON.stringify(G.buffs));
    for (let i = 0; i < 60 * (secs + 1); i++) zb.step(1 / 60);
    check('drop: the buff ends (buffEnd{id}) after its seconds', be2.length === 1 && be2[0].id === orb.id && G.buffs[orb.id] === undefined);
    // an orb nobody collects is gone after a while
    lab3(1); G.z = 0; T.dropBrute = 1;
    const br3 = mk3(3.5, -4, 1); br3.big = true;
    zb.spawnBullet(3.5, -1, 0, -1, 1, 0, 1);
    for (let i = 0; i < 12; i++) zb.step(1 / 60);
    T.dropBrute = keepD;
    const orb2 = G.events.filter(e => e.type === 'powerup').pop();
    G.x = G.tx = -3.5; for (const s of G.soldiers) s.x = -3.5;
    orb2.x = 3.5; orb2.z = G.z - 6;
    for (let i = 0; i < 60 * 17; i++) { orb2.x = 3.5; zb.step(1 / 60); }
    check('drop: an orb that is not collected expires (gone)', orb2.gone === true && orb2.taken === false);
    k2.forEach(f => f());

    // crit: doubles the hit, throttled event
    lab3(1); G.z = 0;
    T.critBase = 1;
    const cr = []; const k3 = listen('crit', cr);
    const big = mk3(0, -4, 1e6);
    zb.spawnBullet(0, -1, 0, -1, 10, 0, 1);
    for (let i = 0; i < 12; i++) zb.step(1 / 60);
    const lost1 = 1e6 - big.hp;
    check('crit: a crit hit does critMul x the damage', Math.abs(lost1 - 10 * T.critMul) < 1e-6, lost1);
    cr.length = 0;
    for (let t = 0; t < 60; t++) { for (let q = 0; q < 8; q++) zb.spawnBullet(0, -3.4, 0, -1, 1, 0, 3); zb.step(1 / 60); }
    k3();
    T.critBase = 0;
    check('crit: the crit event is throttled to at most 6 a second (hundreds of crit hits in a second -> <= 7 events)', cr.length >= 3 && cr.length <= 7, cr.length);

    // squad milestones
    zb.resetSave(); zb.startStage(1);
    const sm = []; const k4 = listen('squadMilestone', sm);
    G.shield = 1e9; G.squad = 12; zb.syncSoldiers(); zb.step(1 / 60);
    G.squad = 30; zb.syncSoldiers(); zb.step(1 / 60);
    G.squad = 60; zb.syncSoldiers(); zb.step(1 / 60); zb.step(1 / 60);
    k4();
    check('squad milestones: 10, 25, 50 fire once each as the squad grows', sm.map(m => m.n).join() === '10,25,50', sm.map(m => m.n).join());
    zb.SAVE.nodes[zb.mainId(2)] = { entry: 30, stars: 0 };
    zb.startStage(2);
    const sm2 = []; const k5 = listen('squadMilestone', sm2);
    G.shield = 1e9; zb.step(1 / 60); G.squad = 55; zb.syncSoldiers(); zb.step(1 / 60); zb.step(1 / 60);
    k5();
    check('squad milestones: only those above the entry squad count in a run (entry 30 -> just 50)', sm2.map(m => m.n).join() === '50', sm2.map(m => m.n).join());
    zb.resetSave();
  }

  // ================================================================ round 4: lanes, routes, road limits, upgrade clamping
  {
    zb.resetSave();
    const lanesX = zb.LANES;
    const rowsOf = stage => {                           // gun rows of a stage: unpicked weapon events grouped by z
      zb.prepare(stage);
      const rows = [];
      for (const e of G.events.filter(q => q.type === 'weapon').sort((a, b) => b.z - a.z)) {
        const r = rows[rows.length - 1];
        if (r && Math.abs(r[0].z - e.z) <= 2.5) r.push(e); else rows.push([e]);
      }
      return rows;
    };
    let bad = '', empties = new Set(), nrows = 0;
    for (let sNo = 1; sNo <= 14; sNo++) {
      const rows = rowsOf(sNo);
      rows.forEach((r, i) => {
        nrows++;
        const used = new Set(r.map(e => lanesX.indexOf(e.x)));
        if (r.length > 2) bad += ` st${sNo} row${i} has ${r.length} guns;`;
        if ([...used].some(l => l < 0)) bad += ` st${sNo} row${i} off-lane x;`;
        if (used.size !== r.length) bad += ` st${sNo} row${i} two guns in one lane;`;
        if (r.some(e => e.z !== r[0].z)) bad += ` st${sNo} row${i} not one z;`;
        if (i > 0 && rows[i - 1][0].z - r[0].z <= 2.5) bad += ` st${sNo} rows too close;`;
        if (i > 0 || sNo >= 1) for (let l = 0; l < 3; l++) if (!used.has(l) && i > 0) empties.add(l);
      });
    }
    check('lanes: every gun row (stages 1-14) sits on lane centres, uses at most 2 of the 3 lanes, one z per row, rows > 2.5 apart', bad === '' && nrows > 40, bad || nrows);
    check('lanes: which lane is blank varies across rows (all three lanes are blank somewhere)', empties.size === 3, [...empties].join());
    {
      let ok = true;
      for (let sNo = 1; sNo <= 14; sNo++) {
        zb.prepare(sNo);
        const rifle = G.events.find(e => e.type === 'weapon');
        const gate = G.events.find(e => e.type === 'gate' && e.pair === undefined), hero = G.events.find(e => e.type === 'hero');
        if (!(rifle.w === 1 && rifle.x === lanesX[1] && zb.laneOf(gate.x) !== 1 && zb.laneOf(hero.x) !== 1)) ok = false;
      }
      check('lanes: the opening rifle stays in the middle lane, the opening gate and battery in the side lanes', ok);
    }
    // behaviour: a 50-soldier squad in the blank lane keeps its gun, in a gun lane it takes it
    {
      const tryLane = (x, withWeapon) => {
        zb.prepare(3); zb.start();
        for (const e of G.events) { if (e.type === 'horde') e.spawned = true; else if (e.type === 'gate') e.used = true; }
        G.squad = 50; zb.syncSoldiers(); G.shield = 1e9; G.weapon = withWeapon; G.weaponLv = 1;
        const row = G.events.filter(e => e.type === 'weapon' && e.z < -60).sort((a, b) => b.z - a.z);
        const first = row[0], rowGuns = row.filter(e => e.z === first.z);
        const target = x(rowGuns);
        G.z = first.z + 0.3; G.x = G.tx = target;
        for (const s of G.soldiers) s.x = target;
        zb.step(1 / 60);
        return { rowGuns, taken: rowGuns.filter(e => e.taken), gun: G.weapon, squad: G.squad };
      };
      const blank = rg => lanesX[[0, 1, 2].find(l => !rg.some(e => e.x === lanesX[l]))];
      const a = tryLane(blank, 0);
      check('blank lane: a 50-soldier squad centred in the free lane picks nothing up and keeps its gun and squad size', a.taken.length === 0 && a.gun === 0 && a.squad === 50, JSON.stringify([a.taken.length, a.gun, a.squad]));
      const b = tryLane(rg => rg[0].x, 0);
      check('gun lane: the same squad centred in a gun lane takes that gun (the pair mate disappears)', b.taken.length === b.rowGuns.length && b.gun === b.rowGuns[0].w && b.squad === Math.min(60, 50 + zb.TUNE.crateRecruits), JSON.stringify([b.taken.length, b.gun, b.squad]));
      const c = tryLane(rg => rg[rg.length - 1].x, 0);
      check('gun lane: the other gun of a pair is taken from its own lane', c.taken.length === c.rowGuns.length && c.gun === c.rowGuns[c.rowGuns.length - 1].w, `${c.gun}`);
      // formation overlap no longer counts: squad centre in the middle lane next to a side-lane gun
      zb.prepare(1); zb.start();
      for (const e of G.events) { if (e.type === 'horde') e.spawned = true; else if (e.type === 'gate') e.used = true; }
      const row1 = G.events.filter(e => e.type === 'weapon' && e.z < -60).sort((a, b) => b.z - a.z);
      const side = row1.find(e => Math.abs(e.x) > 2);
      G.squad = 50; zb.syncSoldiers(); G.shield = 1e9; G.weapon = 0;
      G.z = side.z + 0.3; G.x = G.tx = Math.sign(side.x) * 1.0;
      for (const s of G.soldiers) s.x = G.x;
      zb.step(1 / 60);
      check('lanes: a wide squad whose centre is in the middle lane does not take a side-lane gun it only overlaps', !side.taken && G.weapon === 0, `${side.taken} ${G.weapon}`);
    }
  }

  // ---------------------------------------------------------------- 16. route plans
  {
    zb.resetSave();
    const sigOf = n => { zb.prepare(n); return G.route.map(s => s.type).join(','); };
    const sigs = []; for (let n = 1; n <= 12; n++) sigs.push(sigOf(n));
    const has = (n, ...types) => { zb.prepare(n); return types.every(t => G.route.some(s => s.type === t)); };
    const hasN = (id, ...types) => { zb.prepareNode(id); return types.every(t => G.route.some(s => s.type === t)); };
    check('routes (round 7): n1 is a plain straight, n2 has forks, n3a (city) ambushes and a barrel gauntlet, n3b (harbor) narrows, n4a (tunnel) narrows, n4b (forest) a fork and an ambush, n5 a split and an ambush, n2 a fork and a split',
      sigs[0] === 'straight,arena' && hasN('n2', 'fork') && !hasN('n2', 'narrow') && hasN('n3a', 'ambush', 'gauntlet') && !hasN('n3a', 'narrow') && hasN('n3b', 'narrow') && !hasN('n3b', 'fork') && hasN('n4a', 'narrow') && hasN('n4b', 'fork', 'ambush') && hasN('n5', 'split', 'ambush') && hasN('n2', 'split'), sigs.slice(0, 5).join(' | '));
    check('routes: no two consecutive stages (1-12) on the main path share the same segment sequence', sigs.every((q, i) => i === 0 || q !== sigs[i - 1]), sigs.join(' | '));
    {
      const ids12 = zb.mapNodes ? (zb.nodeDef('p12'), Object.keys(zb.SAVE.nodes).length, []) : [];
      let edgeBad = '';
      const seen = ['n1', 'n2', 'n3a', 'n3b', 'n4a', 'n4b', 'n5'];
      for (let d = 6; d <= 12; d++) { if (d % 2 === 0) seen.push('p' + d); else seen.push('p' + d + 'a', 'p' + d + 'b'); }
      const sigN = id => { zb.prepareNode(id); return G.route.map(s => s.type).join(','); };
      for (const id of seen) for (const nx of zb.nodeDef(id).next) if (seen.includes(nx) && sigN(id) === sigN(nx)) edgeBad += ` ${id}->${nx}`;
      check('routes: along EVERY edge of the map (both branches, nodes up to depth 12) parent and child have different segment sequences', edgeBad === '', edgeBad);
    }
    let inv = '';
    for (let n = 1; n <= 12; n++) {
      zb.prepare(n);
      const r = G.route, list = ['dawn', 'haze', 'sunset', 'night', 'storm'];
      if (r[0].z0 !== 0 || r[r.length - 1].type !== 'arena' || r[r.length - 1].z0 !== -G.L) inv += ` st${n} ends;`;
      for (let i = 0; i < r.length; i++) {
        if (!(r[i].z0 > r[i].z1)) inv += ` st${n} seg${i} z0<=z1;`;
        if (i > 0 && r[i].z0 !== r[i - 1].z1) inv += ` st${n} gap before seg${i};`;
        if (r[i].type === 'narrow' && !(r[i].half > 0)) inv += ` st${n} no half;`;
        if (r[i].type === 'fork' && typeof r[i].split !== 'number') inv += ` st${n} no split;`;
      }
      if (!list.includes(G.theme) || !G.routeName) inv += ` st${n} theme/name;`;
      if (G.routeName !== G.node.name || G.scene !== G.node.scene) inv += ` st${n} routeName/scene;`;
    }
    check('routes: segments are sorted, contiguous, start at 0 and end with the arena at -G.L; narrow has half, fork has split; theme and name are set', inv === '', inv);
    const names = new Set(), themes = new Set();
    for (let n = 1; n <= 5; n++) { zb.prepare(n); names.add(G.routeName); themes.add(G.theme); }
    check('routes: stages 1-5 each have their own name and theme', names.size === 5 && themes.size >= 4, [...names].join('/') + ' ' + [...themes].join('/'));
    zb.prepare(4); const rA = JSON.stringify(G.route), arrA = G.route, evA = JSON.stringify(G.events.map(e => [e.type, +e.z.toFixed(3), +(e.x || 0).toFixed(3), e.spec ? [e.spec.kind, e.spec.count, e.spec.cx] : 0]));
    zb.start(); for (let i = 0; i < 20; i++) zb.step(1 / 60);
    zb.prepare(4);
    check('routes: same stage = same route and events on retry, and the route is a fresh array', JSON.stringify(G.route.map(s => { const c = { ...s }; delete c.chosen; return c; })) === JSON.stringify(JSON.parse(rA).map(s => { delete s.chosen; return s; })) && G.route !== arrA && JSON.stringify(G.events.map(e => [e.type, +e.z.toFixed(3), +(e.x || 0).toFixed(3), e.spec ? [e.spec.kind, e.spec.count, e.spec.cx] : 0])) === evA);
    check('routes: a stage beyond the handcrafted ones is seeded procedural (6+ identical on rebuild)', (() => { const a = sigOf(8), t = G.theme, nm = G.routeName; const b = sigOf(8); return a === b && t === G.theme && nm === G.routeName; })());
    // contents fit the segment
    {
      zb.prepare(2);
      const f = G.route.find(s => s.type === 'fork');
      const inF = G.events.filter(e => e.z <= f.z0 && e.z > f.z1);
      const sideOf = e => (e.type === 'horde' ? e.spec.cx : e.x) >= f.split ? 1 : -1;
      const left = inF.filter(e => (e.type === 'horde' || e.type === 'gate' || e.type === 'barrel') && sideOf(e) < 0), right = inF.filter(e => (e.type === 'horde' || e.type === 'gate' || e.type === 'barrel') && sideOf(e) > 0);
      const sig = a => a.map(e => e.type + (e.spec ? e.spec.kind : '')).sort().join();
      check('fork: both sides have contents and they differ; no gun rows inside a fork', left.length && right.length && sig(left) !== sig(right) && !inF.some(e => e.type === 'weapon'), sig(left) + ' | ' + sig(right));
      zb.prepareNode('n3a');
      const amb = G.events.filter(e => e.type === 'horde' && e.ahead);
      const pairs = amb.every(e => amb.some(o => o !== e && o.z === e.z && Math.sign(o.spec.cx) === -Math.sign(e.spec.cx)));
      check('ambush: hordes come in left/right pairs at the same z and are released late', amb.length >= 2 && pairs && amb.every(e => e.ahead < zb.TUNE.spawnAhead));
      zb.prepareNode('n3b');
      const nrw = G.route.filter(s => s.type === 'narrow');
      const hs = G.events.filter(e => e.type === 'horde' && nrw.some(s => e.z <= s.z0 && e.z > s.z1));
      check('narrow: hordes in a narrow come head-on and fit the road', hs.length >= 3 && hs.every(e => { const s = nrw.find(q => e.z <= q.z0 && e.z > q.z1); return e.spec.cx === 0 && e.spec.w <= 2 * s.half; }));
    }
  }

  // ---------------------------------------------------------------- 17. road limits: narrow, fork median, routeSegment
  {
    zb.resetSave();
    const lab4 = stage => {                              // running phase, nothing spawns or triggers, the squad stands where we put it
      zb.prepare(stage); zb.start();
      for (const e of G.events) { if (e.type === 'horde') e.spawned = true; else if (e.type === 'gate') e.used = true; else if (e.type === 'weapon') e.taken = true; else if (e.type === 'hero') e.missed = true; }
      G.squad = 30; zb.syncSoldiers(); G.shield = 1e9;
      for (const s of G.soldiers) s.cd = 1e9;
    };
    const mk4 = (x, z, hp) => { zb.spawnHorde({ kind: 'lab', cx: x, w: 0, d: 0, count: 1, hp }, z); const q = Z[Z.length - 1]; q.x = x; q.sp = 0; q.hp = hp; return q; };
    // routeSegment: walk the whole of stage 2 and collect the events
    {
      lab4(2);
      const segs = []; const off = listen('routeSegment', segs);
      const keepRun = zb.TUNE.run; zb.TUNE.run = 60;
      for (let i = 0; i < 6000 && G.phase === 'run'; i++) { G.shield = 1e9; zb.step(1 / 60); }
      zb.TUNE.run = keepRun; off();
      const want = zb.G.route.map(s => s.type);
      check('routeSegment: fires once per segment in order as the squad enters it (payload seg, index)', segs.length >= want.length - 1 && segs.every((q, i) => q.seg === G.route[i] && q.index === i) && segs[0].seg.type === 'straight', segs.map(q => q.seg.type).join() + ' vs ' + want.join());
    }
    // narrow
    {
      lab4('n3b');
      const nr = G.route.find(s => s.type === 'narrow');
      G.z = nr.z0 - 5;
      zb.step(1 / 60);
      G.tx = 3.5; for (let i = 0; i < 90; i++) { G.shield = 1e9; zb.step(1 / 60); }
      const maxX = Math.max(...G.soldiers.map(s => Math.abs(s.x))), pb = zb.pathBounds();
      check('narrow: the squad centre is clamped so the whole formation stays inside the road, the formation uses fewer columns', Math.abs(G.x) + zb.formationHalf() <= nr.half - 0.3 + 0.01 && maxX <= nr.half + 0.05 && zb.formationHalf() < 1.24 + 1e-9 && pb.cols <= Math.floor((2 * nr.half - 0.6) / 0.62) + 1, `x ${G.x.toFixed(2)} half ${zb.formationHalf().toFixed(2)} maxX ${maxX.toFixed(2)} cols ${pb.cols}`);
      const z1 = mk4(3.0, G.z - 4, 100), z2 = mk4(-3.0, G.z - 4, 100);
      z1.sp = z2.sp = 0.5;
      for (let i = 0; i < 30; i++) { G.shield = 1e9; zb.step(1 / 60); }
      check('narrow: zombies are clamped to the road too', Math.abs(z1.x) <= nr.half - 0.3 + 1e-6 && Math.abs(z2.x) <= nr.half - 0.3 + 1e-6, `${z1.x} ${z2.x}`);
      G.z = nr.z1 + 3; G.tx = 3.5; for (let i = 0; i < 90; i++) { G.shield = 1e9; zb.step(1 / 60); if (G.z < nr.z1) break; }
      G.z = nr.z1 - 3; G.tx = 3.5; for (let i = 0; i < 60; i++) { G.shield = 1e9; zb.step(1 / 60); }
      check('narrow: after the segment the full deck is back', G.x > nr.half, `x ${G.x.toFixed(2)}`);
    }
    // fork median
    {
      lab4(2);
      const f = G.route.find(s => s.type === 'fork');
      G.z = f.z0 + 3; G.x = G.tx = 2.0; for (const s of G.soldiers) s.x = 2.0;
      for (let i = 0; i < 4; i++) zb.step(1 / 60);
      for (let i = 0; i < 60 && G.z > f.z0 - 1; i++) { G.shield = 1e9; zb.step(1 / 60); }
      check('fork: entering the fork on the right locks the right side (seg.chosen = 1)', f.chosen === 1, `${f.chosen} z ${G.z.toFixed(1)} z0 ${f.z0}`);
      G.tx = -3.5; for (let i = 0; i < 90; i++) { G.shield = 1e9; zb.step(1 / 60); }
      const minSoldier = Math.min(...G.soldiers.map(s => s.x));
      check('fork: the squad cannot cross the median to the other side, formation included', G.x >= f.split + 0.45 && minSoldier >= f.split + 0.2 && G.z > f.z1, `x ${G.x.toFixed(2)} min ${minSoldier.toFixed(2)}`);
      const zl = mk4(-1.0, G.z - 5, 100), zr = mk4(1.0, G.z - 5, 100);
      zl.sp = zr.sp = 0.3;
      for (let i = 0; i < 60; i++) { G.shield = 1e9; zb.step(1 / 60); }
      check('fork: zombies stay on their own side (left stays left, right stays right)', zl.x <= f.split - 0.45 + 1e-6 && zr.x >= f.split + 0.45 - 1e-6, `${zl.x.toFixed(2)} ${zr.x.toFixed(2)}`);
      // the other choice
      lab4(2);
      const f2 = G.route.find(s => s.type === 'fork');
      G.z = f2.z0 + 3; G.x = G.tx = -2.0; for (const s of G.soldiers) s.x = -2.0;
      for (let i = 0; i < 4; i++) zb.step(1 / 60);
      for (let i = 0; i < 60 && G.z > f2.z0 - 1; i++) { G.shield = 1e9; zb.step(1 / 60); }
      G.tx = 3.5; for (let i = 0; i < 90; i++) { G.shield = 1e9; zb.step(1 / 60); }
      check('fork: a squad that entered on the left stays left', f2.chosen === -1 && G.x <= f2.split - 0.45, `chosen ${f2.chosen} x ${G.x.toFixed(2)}`);
    }
  }

  // ---------------------------------------------------------------- 18. upgrades: clamp on load, lookup by id
  {
    zb.resetSave();
    localStorage.setItem('zombie-bridge-save', JSON.stringify({ v: 1, coins: 50, best: 2, upgrades: { dmg: 8, rate: 10, recruit: 9, shield: 7, luck: 99 }, stages: {} }));
    zb.loadSave();
    check('upgrades: levels above max in an old save are clamped to max (5) on load', zb.UPGRADES.every(u => u.max === 5) && zb.UPGRADES.every(u => zb.SAVE.upgrades[u.id] === u.max), JSON.stringify(zb.SAVE.upgrades));
    check('upgrades: the clamped levels cannot be bought further', zb.buyUpgrade('dmg') === false);
    {
      const U = id => zb.UPGRADES.find(u => u.id === id);
      check('upgrades: the owner\'s steps (+10% damage, +8% fire rate, +15% coins and +3% crit per level), all max 5', U('dmg').per === 0.10 && U('rate').per === 0.08 && U('luck').per === 0.15 && zb.TUNE.critPerLuck === 0.03 && zb.UPGRADES.every(u => u.max === 5));
      check('upgrades: the shop text shows the real numbers', ['dmg', 'rate', 'luck'].every(id => U(id).desc.includes(Math.round(U(id).per * 100) + '%')) && U('luck').desc.includes(Math.round(zb.TUNE.critPerLuck * 100) + '%'), zb.UPGRADES.map(u => u.desc).join(' | '));
    }
    zb.resetSave();
    // by id, not by index: reversing the table must not change what a dmg level does
    const shot = () => {
      zb.resetSave(); zb.SAVE.upgrades.dmg = 3;
      lab3(1);
      const t = mk3(0.14, -3, 100); t.s = 1.6;
      G.weapon = 1; G.weaponLv = 1; G.soldiers[0].cd = 0;
      zb.step(1 / 60); G.soldiers[0].cd = 1e9;
      for (let i = 0; i < 30; i++) zb.step(1 / 60);
      return 100 - t.hp;
    };
    const d1 = shot();
    const saved = zb.UPGRADES.slice(); zb.UPGRADES.reverse();
    const d2 = shot();
    zb.UPGRADES.length = 0; saved.forEach(u => zb.UPGRADES.push(u));
    const per = zb.UPGRADES.find(u => u.id === 'dmg').per;
    check('upgrades: effects are looked up by id (reordering the table changes nothing)', Math.abs(d1 - d2) < 1e-9 && Math.abs(d1 - (1 + 3 * per)) < 1e-6, `${d1} ${d2}`);
    zb.resetSave();
  }

  // ================================================================ round 5: trajectories and the squad cap
  {
    zb.resetSave();
    const W = zb.WEAPONS, T5 = zb.TUNE;
    const trajOf = id => W.find(g => g.id === id).traj;
    check('traj: every gun has its own flight model (straight, burst, fan, spray, beam, stream, lob)', ['pistol', 'rifle', 'shotgun', 'gatling', 'sniper', 'flamer', 'rocket'].map(trajOf).join() === 'straight,burst,fan,spray,beam,stream,lob');
    const track = (spawn, steps, grab) => {                    // spawn bullet(s), step, sample a bullet each step
      lab3(1); G.z = 0;
      spawn();
      const out = [];
      for (let i = 0; i < steps; i++) { zb.step(1 / 60); const st = zb.stats(); out.push(grab(st)); }
      return out;
    };
    // straight
    {
      const tr = track(() => zb.spawnBullet(0, -1, 0, -1, 1, 0, 0), 12, st => [st.bx[0], st.bz[0], st.by[0], st.bs[0]]);
      check('traj straight: dead straight at constant speed and height', tr.every(q => Math.abs(q[0]) < 1e-6 && q[2] === 1.25 && q[3] === W[0].speed) && Math.abs((tr[0][1] - tr[11][1]) - 11 * W[0].speed / 60) < 1e-3);
    }
    // burst cadence (real soldier firing the rifle at a far, tough target)
    {
      lab3(1); G.z = 0; G.weapon = 1; G.weaponLv = 1;
      const t = mk3(0, -14, 1e9); t.sp = 0;
      const times = []; const off = listen('shot', times);
      G.soldiers[0].cd = 0;
      for (let i = 0; i < 360; i++) { G.shield = 1e9; zb.step(1 / 60); }
      off();
      const ts = times.length;
      // times are not stamped by the event: re-run recording G.time
      lab3(1); G.z = 0; G.weapon = 1; G.weaponLv = 1; const t2 = mk3(0, -14, 1e9); t2.sp = 0;
      const stamps = []; const h = () => stamps.push(G.time); zb.bus.on('shot', h);
      G.soldiers[0].cd = 0;
      for (let i = 0; i < 360; i++) { G.shield = 1e9; zb.step(1 / 60); }
      zb.bus.map.shot.splice(zb.bus.map.shot.indexOf(h), 1);
      const gaps = stamps.slice(1).map((v, i) => v - stamps[i]);
      const short = gaps.filter(g => g <= 0.095).length, long = gaps.filter(g => g > 0.095).length;
      const rate = (stamps.length - 1) / (stamps[stamps.length - 1] - stamps[0]);
      check('traj burst: rounds come in bursts of 3 (two short gaps, then a pause) and the average rate is the gun rate', stamps.length > 20 && short / (short + long) > 0.55 && short / (short + long) < 0.78 && gaps.every(g => g > W[1].burstGap * 0.9) && Math.abs(rate / W[1].rate - 1) < 0.2, `short ${short} long ${long} rate ${rate.toFixed(2)} vs ${W[1].rate}`);
    }
    // fan: pellets spread wide and decelerate
    {
      lab3(1); G.z = 0; G.weapon = 2; G.weaponLv = 1;
      const t = mk3(0, -14, 1e9); t.sp = 0;
      G.soldiers[0].cd = 0; zb.step(1 / 60);
      const st0 = zb.stats(), dirs = [];
      for (let i = 0; i < st0.bullets; i++) dirs.push(st0.bx[i]);
      G.soldiers[0].cd = 1e9;
      const v0 = st0.bs[0];
      for (let i = 0; i < 12; i++) zb.step(1 / 60);
      const st1 = zb.stats();
      const spreadNow = Math.max(...st1.bx) - Math.min(...st1.bx);
      check('traj fan: five pellets fan out wide (>= 2 units apart after 0.2 s)', st0.bullets === 5 && spreadNow > 2, `${st0.bullets} ${spreadNow.toFixed(2)}`);
      const ratio = st1.bs[0] / v0, want = Math.exp(-W[2].drag * (13 / 60));
      check('traj fan: pellets decelerate exponentially (speed ratio after 13 steps matches exp(-drag t))', Math.abs(ratio - want) < 0.03, `${ratio.toFixed(3)} vs ${want.toFixed(3)}`);
      const noDrag = W[2].speed * W[2].range;
      const tr = track(() => zb.spawnBullet(0, -1, 0, -1, 1, 0, 2), 40, st => st.bullets ? st.bz[0] : null);
      const last = tr.filter(v => v !== null).pop();
      check('traj fan: the effective range is much shorter than speed x life', -1 - last < noDrag * 0.8 && -1 - last > 5, `${(-1 - last).toFixed(1)} vs ${noDrag.toFixed(1)}`);
    }
    // spray: sinusoidal weave in x, phase per soldier
    {
      const a = track(() => zb.spawnBullet(0, -1, 0, -1, 1, 0, 3, 0), 30, st => st.bx[0]);
      const b = track(() => zb.spawnBullet(0, -1, 0, -1, 1, 0, 3, 1.5), 30, st => st.bx[0]);
      const amp = Math.max(...a.filter(v => v !== undefined).map(Math.abs));
      let flips = 0; for (let i = 2; i < a.length; i++) if ((a[i] - a[i - 1]) * (a[i - 1] - a[i - 2]) < 0) flips++;
      check('traj spray: x weaves sinusoidally around the aim line (amplitude ~weaveAmp, several reversals)', amp > W[3].weaveAmp * 0.7 && amp < W[3].weaveAmp * 1.6 && flips >= 2, `amp ${amp.toFixed(2)} flips ${flips}`);
      check('traj spray: the phase differs per soldier (a different weave for ph = 1.5)', a.some((v, i) => Math.abs(v - b[i]) > 0.15));
    }
    // beam
    {
      const tr = track(() => zb.spawnBullet(0, -1, 0, -1, 1, 0, 4), 4, st => st.bullets ? [st.bx[0], st.bz[0]] : null);
      const stepLen = tr[0] && tr[1] ? tr[0][1] - tr[1][1] : 0;
      check('traj beam: near-instant (>= 2.5 units a step), dead straight', stepLen > 2.5 && tr.every(q => !q || Math.abs(q[0]) < 1e-6), stepLen.toFixed(2));
      lab3(1); G.z = 0; const line5 = []; for (let i = 0; i < 8; i++) line5.push(mk3(0, -4 - i * 1.0, 100)); zb.spawnBullet(0, -1, 0, -1, 7, 0, 4);
      for (let i = 0; i < 6; i++) zb.step(1 / 60);
      check('traj beam: one step crosses the whole line, pierce as before (pierce + 1 zombies hit, none skipped)', line5.filter(q => q.hp < 100).length === W[4].pierce + 1 && line5.slice(0, W[4].pierce + 1).every(q => q.hp < 100));
    }
    // stream
    {
      const tr = track(() => zb.spawnBullet(0, -1, 0, -1, 1, 0, 5, 1), 45, st => st.bullets ? [st.bs[0], st.by[0], st.bx[0], st.bz[0]] : null);
      const live = tr.filter(Boolean);
      check('traj stream: speed decays with drag', live[0][0] > live[live.length - 1][0] * 1.3 && live.every((q, i) => i === 0 || q[0] < live[i - 1][0]));
      check('traj stream: it rises (by goes up from 0.9) and drifts sideways', live[0][1] >= 0.9 && live[live.length - 1][1] > live[0][1] + 0.3 && Math.abs(live[live.length - 1][2]) > 0.1 && live.every((q, i) => i === 0 || q[1] >= live[i - 1][1]), `${live[0][1].toFixed(2)} -> ${live[live.length - 1][1].toFixed(2)} x ${live[live.length - 1][2].toFixed(2)}`);
      check('traj stream: short life', tr[tr.length - 1] === null && -1 - live[live.length - 1][3] < 13);
    }
    // lob
    {
      const tr = track(() => zb.spawnBullet(0, -1, 0, -1, 4, 0, 6, 0, 0, -13), 70, st => st.bullets ? [st.by[0], st.bz[0], st.bx[0]] : null);
      const live = tr.filter(Boolean);
      const peak = Math.max(...live.map(q => q[0]));
      const peakI = live.findIndex(q => q[0] === peak);
      check('traj lob: launches up from by = 1.6, climbs to the apex (lobPeak) and comes down: a parabola', live[0][0] > 1.6 && Math.abs(peak - T5.lobPeak) < 0.25 && peakI > 3 && peakI < live.length - 3 && live.slice(peakI).every((q, i, a) => i === 0 || q[0] <= a[i - 1][0]), `peak ${peak.toFixed(2)} at ${peakI}/${live.length}`);
      check('traj lob: it lands near the aim point (z = -13) and is gone', tr[tr.length - 1] === null && Math.abs(live[live.length - 1][1] + 13) < 2.5, `z ${live[live.length - 1][1].toFixed(1)}`);
      lab3(1); G.z = 0;
      const ex = []; const off = listen('explode', ex);
      zb.spawnBullet(0, -1, 0, -1, 4, 0, 6, 0, 0, -13);
      let landedAt = -1;
      for (let i = 0; i < 70; i++) { zb.step(1 / 60); if (ex.length && landedAt < 0) landedAt = i; }
      off();
      check('traj lob: it explodes exactly once when it reaches the ground (no zombie needed)', ex.length === 1 && Math.abs(ex[0].r - W[6].splash) < 1e-6 && Math.abs(ex[0].z + 13) < 2.5 && zb.stats().bullets === 0, JSON.stringify(ex));
      // flies over the front rows, explodes on contact in the end
      lab3(1); G.z = 0;
      const near = mk3(0, -3, 100), tgt = mk3(0, -13, 100);
      const ex2 = []; const off2 = listen('explode', ex2);
      zb.spawnBullet(0, -1, 0, -1, 4, 0, 6, 0, 0, -13);
      let nearHurtEarly = false;
      for (let i = 0; i < 70; i++) { zb.step(1 / 60); if (i < 10 && near.hp < 100) nearHurtEarly = true; }
      off2();
      check('traj lob: it flies over a zombie close to the squad and comes down on the target (direct hit + blast)', !nearHurtEarly && near.hp === 100 && tgt.hp <= 100 - 4 && ex2.length === 1, `${near.hp} ${tgt.hp}`);
      // homing: a zombie off to the side of the aim point pulls the shell toward it
      const landX = (withZombie) => {
        lab3(1); G.z = 0;
        const z = withZombie ? mk3(1.4, -13, 1e9) : null; if (z) z.sp = 0;
        const exs = []; const o = listen('explode', exs);
        zb.spawnBullet(0, -1, 0, -1, 4, 0, 6, 0, 0, -13);
        for (let i = 0; i < 70; i++) zb.step(1 / 60);
        o();
        return exs.length ? exs[0].x : null;
      };
      const x0 = landX(false), x1 = landX(true);
      check('traj lob: it homes gently toward the zombie nearest its aim point (lands closer to it)', x0 !== null && x1 !== null && x1 > x0 + 0.25 && x1 < 1.9, `${x0} -> ${x1}`);
      // a lob crossing a gate plane counts
      lab3(1); G.z = 0;
      const gate = G.events.find(e => e.type === 'gate' && e.kind === 'add');
      gate.used = false; gate.z = -8; gate.x = 0; gate.hits = 0;
      const gh = []; const og = listen('gateHit', gh);
      zb.spawnBullet(0, -1, 0, -1, 4, 0, 6, 0, 0, -13);
      for (let i = 0; i < 70; i++) zb.step(1 / 60);
      og();
      check('traj lob: a lob that passes the gate plane (even high above it) counts as a hit on the gate', gh.length === 1 && gh[0].e === gate, gh.length);
    }
    // by / bt integrity through swap-removals, shells arc cosmetically
    {
      lab3(1); G.z = 0;
      const order = [[4, 0], [6, 0], [5, 1], [0, 0], [3, 0], [2, 0]];
      order.forEach(([w, ph]) => zb.spawnBullet(3.9, -1, 0, -1, 1, 0, w, ph, 3.9, -12));
      for (let i = 0; i < 4; i++) zb.step(1 / 60);
      zb.spawnBullet(3.9, -1, 0, -1, 1, 0, 0);               // a late one
      for (let i = 0; i < 12; i++) zb.step(1 / 60);
      const st = zb.stats();
      let ok = st.bullets >= 3, why = '';
      for (let k = 0; k < st.bullets; k++) {
        const age = st.bw[k] === 0 && st.bt[k] < 0.11 && k === st.bullets - 1 ? 6 / 60 : 10 / 60;
        const expectAge = (st.bt[k] > 0.23) ? 16 / 60 : 12 / 60;
        if (Math.abs(st.bt[k] - expectAge) > 1e-4) { ok = false; why += ` slot${k} gun${st.bw[k]} bt ${st.bt[k]}`; }
        const g = st.bw[k];
        if (g === 6 && !(st.by[k] > 1.0 && st.by[k] < 3.2)) { ok = false; why += ` lob by ${st.by[k]}`; }
        if (g === 5 && !(st.by[k] > 0.9)) { ok = false; why += ` stream by ${st.by[k]}`; }
        if ((g === 0 || g === 2) && st.by[k] !== 1.25) { ok = false; why += ` flat by ${st.by[k]}`; }
        if (st.bt[k] > 0 && st.bl[k] > W[g].range + 1e-6) { ok = false; why += ` life ${g}`; }
      }
      check('by / bt: every surviving bullet keeps its own age and height through swap-removals (beam gone, lob/stream/flat still right)', ok && !st.bw.includes(4), why + ' ' + JSON.stringify(st.bw));
      // mech shells: cosmetic arc only
      lab3(1); G.z = 0;
      zb.spawnBullet(3.9, -1, 0, -1, 1, 1, 0);
      const ys = []; for (let i = 0; i < 20; i++) { zb.step(1 / 60); const s2 = zb.stats(); if (s2.bullets) ys.push(s2.by[0]); }
      check('by / bt: a mech shell (bk = 1) arcs cosmetically: height rises above 1.25 and the path stays flat', Math.max(...ys) > 1.9 && (() => { const s2 = zb.stats(); return !s2.bullets || Math.abs(s2.bx[0] - 3.9) < 1e-6; })());
    }
    // squad cap 100
    {
      zb.resetSave(); zb.startStage(1);
      G.shield = 1e9; G.squad = 99; zb.syncSoldiers();
      check('cap: the squad cap and the number of drawn soldiers are both 100', T5.maxSquad === 100 && G.soldiers.length === 99);
      G.squad = 100; zb.syncSoldiers();
      check('cap: all 100 soldiers are drawn and nothing multiplies damage', G.soldiers.length === 100 && G.dmgMul === 1);
      for (const e of G.events) if (e.type === 'gate') e.used = true;
      const wk = G.events.find(e => e.type === 'weapon'); wk.taken = false; G.weapon = 1; G.z = wk.z + 0.3; G.x = G.tx = wk.x; zb.step(1 / 60);
      check('cap: crates cannot push the squad above 100', G.squad === 100, G.squad);
      {
        const rowsFor = n => { G.squad = n; zb.syncSoldiers(); const r = Math.min(G.soldiers.length, 99) && Math.round(zb.formationHalf() * 2 / 0.62) + 1; return r; };
        const w = [9, 25, 50, 100].map(rowsFor);
        check('formation: rows widen with the squad (9 -> <=5, 25 -> 6, 50 -> 7, 100 -> 8 per row, ~13 rows for 100)', w[0] <= 5 && w[1] === 6 && w[2] === 7 && w[3] === 8 && Math.ceil(100 / w[3]) <= 13, w.join());
        G.squad = 100; zb.syncSoldiers(); G.tx = 3.5; for (let i = 0; i < 90; i++) { G.shield = 1e9; zb.step(1 / 60); }
        check('formation: a squad of 100 in rows of 8 still reaches the side lane (centre in lane 2)', zb.laneOf(G.x) === 2 && G.x + zb.formationHalf() <= 3.56, `x ${G.x.toFixed(2)} half ${zb.formationHalf().toFixed(2)}`);
        G.tx = -3.5; for (let i = 0; i < 90; i++) { G.shield = 1e9; zb.step(1 / 60); }
        check('formation: ... and the other side lane too', zb.laneOf(G.x) === 0, `x ${G.x.toFixed(2)}`);
      }
      zb.SAVE.nodes[zb.mainId(2)] = { entry: 100, stars: 0 };
      localStorage.setItem('zombie-bridge-save', JSON.stringify({ v: 1, coins: 0, best: 2, upgrades: {}, stages: { 2: { entry: 999, stars: 0 } } }));
      zb.loadSave();
      check('cap: an entry squad above the cap loads clamped to 100', zb.entryFor(2) === 100, zb.entryFor(2));
      zb.resetSave();
    }
  }

  // ================================================================ round 7: world map, nodes, SAVE v2
  {
    const SC7 = zb.SCENES;
    zb.resetSave();
    const KEY7 = 'zombie-bridge-save';
    // ---- migration v1 -> v2
    localStorage.setItem(KEY7, JSON.stringify({ v: 1, coins: 77, best: 4, upgrades: { dmg: 2 }, stages: { 2: { entry: 31, stars: 2 }, 3: { entry: 44, stars: 3 }, 4: { entry: 52, stars: 0 } }, rev: 5, updatedAt: 99, epoch: 0 }));
    zb.loadSave();
    const sv = zb.SAVE;
    check('migration v1 -> v2: stage n becomes the main-path node of depth n, cleared when it had stars or lies below best', sv.v === 2 && sv.nodes.n2.entry === 31 && sv.nodes.n2.stars === 2 && sv.nodes.n2.cleared && sv.nodes.n3a.entry === 44 && sv.nodes.n3a.cleared && sv.nodes.n4a.entry === 52 && !sv.nodes.n4a.cleared && sv.nodes.n1.cleared && !('stages' in sv), JSON.stringify(sv.nodes));
    check('migration: cur is the node of depth best, coins / upgrades / best / rev / epoch carry over', sv.cur === 'n4a' && sv.coins === 77 && sv.upgrades.dmg === 2 && sv.best === 4 && sv.rev === 5, `${sv.cur} ${sv.best}`);
    zb.saveGame();
    const once = JSON.stringify(JSON.parse(localStorage.getItem(KEY7)).nodes);
    zb.loadSave(); zb.saveGame();
    check('migration is idempotent: loading the saved v2 again changes nothing', JSON.stringify(JSON.parse(localStorage.getItem(KEY7)).nodes) === once && JSON.parse(localStorage.getItem(KEY7)).v === 2);
    localStorage.removeItem(KEY7); localStorage.setItem('zombie-bridge-best', '3');
    zb.loadSave();
    check('migration of the old best key: nodes up to best, those below best cleared, cur = main node of best', zb.SAVE.nodes.n1.cleared && zb.SAVE.nodes.n2.cleared && !zb.SAVE.nodes.n3a.cleared && zb.SAVE.nodes.n3a.entry === T.migrateEntry && zb.SAVE.cur === 'n3a', JSON.stringify(zb.SAVE.nodes));
    localStorage.removeItem('zombie-bridge-best'); zb.resetSave();

    // ---- the graph: unlocks and branches
    const N = zb.nodeDef;
    check('map: the authored graph - n2 branches into n3a / n3b, they lead on to n4a / n4b, both converge on n5, n5 continues to p6',
      N('n2').next.join() === 'n3a,n3b' && N('n3a').next.join() === 'n4a' && N('n3b').next.join() === 'n4b' && N('n4a').next.join() === 'n5' && N('n4b').next.join() === 'n5' && N('n5').next.join() === 'p6');
    check('map: the a-branch is harder and pays more (city / tunnel), the b-branch is easier (harbor / forest)', N('n3a').diffMul > N('n3b').diffMul && N('n4a').diffMul > N('n4b').diffMul && N('n3a').coinMul > N('n3b').coinMul && N('n4a').coinMul > N('n4b').coinMul && N('n3a').scene === 'city' && N('n4a').scene === 'tunnel' && N('n3b').scene === 'harbor' && N('n4b').scene === 'forest');
    zb.resetSave();
    const st = id => zb.nodeState(id);
    check('unlocks: a fresh save has only n1 open', st('n1') === 'open' && st('n2') === 'locked' && st('n3a') === 'locked');
    const unl = [], clr = [];
    const o1 = listen('nodeUnlocked', unl), o2 = listen('nodeCleared', clr);
    const winNode = (id, squad) => {                               // plays a node to a win with `squad` survivors
      zb.startNode(id);
      G.squad = squad; G.weapon = 3; zb.syncSoldiers(); G.shield = 1e9;
      skipToBoss();
      let guard = 0; while (G.phase !== 'win' && guard++ < 8000) { G.shield = 1e9; zb.step(1 / 60); }
      return G.phase === 'win';
    };
    check('startNode on a locked node is refused', zb.startNode('n3a') === false && G.node.id !== 'n3a');
    const ok1 = winNode('n1', 20);
    check('clearing n1 unlocks n2: nodeCleared{id,stars} then nodeUnlocked{id}', ok1 && clr.length === 1 && clr[0].id === 'n1' && clr[0].stars >= 1 && unl.map(u => u.id).join() === 'n2' && st('n2') === 'open' && st('n1') === 'cleared', JSON.stringify([clr, unl]));
    check('carry-over: n2 gets the survivors as its entry, G.node / G.level follow the node', zb.SAVE.nodes.n2.entry === 20 && zb.entryFor('n2') === 20 && zb.entryFor(2) === 20);
    zb.startNode('n2'); const gotEntry = G.squad, gotNode = G.node.id, gotLevel = G.level; zb.prepare(2);
    check('startNode(n2): starts with the entry squad, G.node.id n2, G.level 2', gotEntry === 20 && gotNode === 'n2' && gotLevel === 2);
    unl.length = 0;
    winNode('n2', 33);
    check('clearing n2 opens BOTH branches (a choice), each with the survivors as entry', unl.map(u => u.id).sort().join() === 'n3a,n3b' && st('n3a') === 'open' && st('n3b') === 'open' && zb.SAVE.nodes.n3a.entry === 33 && zb.SAVE.nodes.n3b.entry === 33, JSON.stringify(unl));
    check('locked stays locked: n4a / n4b / n5 are still locked', st('n4a') === 'locked' && st('n4b') === 'locked' && st('n5') === 'locked');
    unl.length = 0;
    winNode('n3b', 41);
    check('choosing b: clearing n3b unlocks n4b only (a stays open, n4a locked); entry follows the b path', unl.map(u => u.id).join() === 'n4b' && st('n4a') === 'locked' && st('n4b') === 'open' && zb.SAVE.nodes.n4b.entry === 41 && st('n3a') === 'open');
    winNode('n4b', 38);
    check('convergence: n5 opens from the b side and takes its survivors as entry', st('n5') === 'open' && zb.SAVE.nodes.n5.entry === 38);
    winNode('n3a', 55); winNode('n4a', 61);
    check('convergence: when the other branch is cleared later, n5 keeps the LARGER parent survivors (61)', zb.SAVE.nodes.n5.entry === 61 && zb.entryFor('n5') === 61);
    winNode('n5', 70);
    check('clearing n5 unlocks the procedural p6 (generated on demand), best moves to 6', st('p6') === 'open' && zb.SAVE.best === 6 && zb.unlockedDepth() === 6 && zb.nodeDef('p6').depth === 6);
    o1(); o2();
    const ev7 = []; const o3 = listen('mapSelect', ev7);
    // mapSelect: logic prepares the chosen node and records it
    zb.bus.emit('mapSelect', { id: 'n3b' });
    check('mapSelect{id}: the node is prepared (phase menu) and SAVE.cur is set; a locked node is ignored', G.node.id === 'n3b' && G.phase === 'menu' && zb.SAVE.cur === 'n3b' && (zb.bus.emit('mapSelect', { id: 'p9a' }), G.node.id === 'n3b'));
    o3();
    // retry keeps the branch
    zb.startNode('n3b'); zb.prepare(G.level);
    check('prepare(G.level) (retry / menu) keeps the branch node; prepare(G.level + 1) goes on along the path; prepare(n) alone is the main path', G.node.id === 'n3b' && (zb.prepare(4), G.node.id === 'n4b') && (zb.prepare(3), G.node.id === 'n3a') && (zb.prepare('n3b'), G.node.id === 'n3b'));
    // a loss keeps entries and unlocks nothing
    zb.resetSave();
    winNode('n1', 20);
    zb.startNode('n2'); G.squad = 3; zb.syncSoldiers(); G.shield = 0; zb.spawnHorde({ kind: 'test', cx: G.x, w: 1, d: 1, count: 400, hp: 1 }, G.z - 0.3);
    for (let i = 0; i < 120; i++) zb.step(1 / 60);
    check('a lost node: no clear, no unlock, the stored entry is untouched', G.phase === 'over' && st('n2') === 'open' && !zb.SAVE.nodes.n2.cleared && st('n3a') === 'locked' && zb.SAVE.nodes.n2.entry === 20);

    // ---- mapNodes
    zb.resetSave();
    let mn = zb.mapNodes();
    check('mapNodes: fresh save shows the authored graph up to 2 beyond the furthest unlocked depth (1 + 2 = depth 3), only n1 open', mn.map(q => q.id).join() === 'n1,n2,n3a,n3b' && mn[0].state === 'open' && mn[1].state === 'locked', mn.map(q => q.id + ':' + q.state).join());
    winNode('n1', 20); winNode('n2', 30);
    mn = zb.mapNodes();
    const byId = Object.fromEntries(mn.map(q => [q.id, q]));
    check('mapNodes: states, stars and entry per node (cleared / open / locked)', byId.n1.state === 'cleared' && byId.n1.stars >= 1 && byId.n2.state === 'cleared' && byId.n3a.state === 'open' && byId.n3a.entry === 30 && byId.n3b.state === 'open' && byId.n4a.state === 'locked' && byId.n5 && byId.n5.state === 'locked' && !byId.p6, mn.map(q => q.id + ':' + q.state).join());
    check('mapNodes: entries carry every presentation field (name, scene, next, x, y, diffMul, coinMul)', mn.every(q => q.name && SC7[q.scene] && Array.isArray(q.next) && typeof q.x === 'number' && typeof q.y === 'number' && q.diffMul > 0 && q.coinMul > 0));
    // ---- procedural nodes
    zb.nodeDef('p12');
    const ids = zb.mapNodes().map(q => q.id);
    const sig7 = () => JSON.stringify([6, 7, 8, 9, 10, 11, 12].flatMap(d => (d % 2 === 0 ? ['p' + d] : ['p' + d + 'a', 'p' + d + 'b']).map(id => { const q = zb.nodeDef(id); return [id, q.scene, q.next.join('/'), q.diffMul, q.coinMul, q.x, q.y, q.seed]; })));
    const sA = sig7();
    check('procedural nodes: p6 single, p7a / p7b a two-way branch, p8 single, ...; seeded: the same on a second read', zb.nodeDef('p6').next.join() === 'p7a,p7b' && zb.nodeDef('p7a').next.join() === 'p8' && zb.nodeDef('p8').next.join() === 'p9a,p9b' && zb.nodeDef('p7a').diffMul > zb.nodeDef('p7b').diffMul && zb.nodeDef('p7a').coinMul > zb.nodeDef('p7b').coinMul && sig7() === sA);
    check('procedural nodes: a branch pair has two different scenes, neither is the parent scene; scenes are known scenes', [7, 9, 11].every(d => { const a = zb.nodeDef('p' + d + 'a'), b = zb.nodeDef('p' + d + 'b'), par = zb.nodeDef('p' + (d - 1)); return a.scene !== b.scene && a.scene !== par.scene && b.scene !== par.scene && SC7[a.scene] && SC7[b.scene]; }));
    check('procedural nodes: x / y laid out (a left, b right, singles in the middle, y falling with depth), names carry the scene', zb.nodeDef('p7a').x < 0.5 && zb.nodeDef('p7b').x > 0.5 && zb.nodeDef('p8').x === 0.5 && zb.nodeDef('p8').y < zb.nodeDef('p7a').y && zb.nodeDef('p8').name.includes(zb.SCENES[zb.nodeDef('p8').scene].name));
    check('procedural nodes: invalid ids are unknown', zb.nodeDef('zz') === null && zb.nodeDef('p0x') === null);
    zb.resetSave();
  }

  // ================================================================ round 7 step 3: obstacles
  {
    const labO = (squad, id) => {                       // a quiet stretch of road: nothing spawns, the squad never fires, no generated obstacles
      T.obsOn = 0; zb.prepareNode(id || 'n2'); T.obsOn = 1;
      zb.start();
      for (const e of G.events) { if (e.type === 'horde') e.spawned = true; else if (e.type === 'gate') e.used = true; else if (e.type === 'weapon') e.taken = true; else if (e.type === 'hero') e.missed = true; }
      G.phase = 'run'; G.z = -60; G.x = G.tx = 0; G.squad = squad; zb.syncSoldiers(); G.shield = 0;
      for (const s of G.soldiers) { s.cd = 1e9; s.x = 0; s.z = G.z + 1; }
      for (let i = 0; i < 30; i++) zb.step(1 / 60);        // let the formation settle
    };
    const addO = (kind, x, dz) => { const o = zb.makeObstacle(kind, x, G.z + dz, 0); G.events.push(o); return o; };
    const run = n => { for (let i = 0; i < n && G.phase === 'run'; i++) zb.step(1 / 60); };
    const hits = [], brk = [], go = [];
    const o1 = listen('obstacleHit', hits), o2 = listen('obstacleBreak', brk), o3 = listen('gameOver', go);
    const lostSum = () => hits.reduce((a, h) => a + h.n, 0);
    const clr = () => { hits.length = 0; brk.length = 0; go.length = 0; };

    // ---- soldiers overlapping an obstacle die
    clr(); labO(6); addO('wreck', 0, -10);
    run(260);
    check('obstacle: driving a small squad head-on into a wreck loses every soldier that reaches it - gameOver cause obstacle, kind wreck', G.phase === 'over' && go.length === 1 && go[0].cause === 'obstacle' && go[0].kind === 'wreck' && lostSum() === 6, `${G.phase} ${JSON.stringify(go)} lost ${lostSum()}`);
    check('obstacle: obstacleHit{x,z,n,kind} - once per obstacle per step, n soldiers, positions of the obstacle', hits.length > 0 && hits.every(h => h.kind === 'wreck' && h.n >= 1 && h.x === 0 && typeof h.z === 'number'), JSON.stringify(hits[0]));
    clr(); labO(20); G.x = G.tx = -0.5; for (const s of G.soldiers) s.x = -0.5; addO('wreck', -2.6, -12);
    run(300);
    check('obstacle: grazing a wreck with the formation edge loses only the soldiers that overlap', G.phase === 'run' && lostSum() > 0 && lostSum() < 20 && G.squad === 20 - lostSum(), `${G.phase} lost ${lostSum()} squad ${G.squad}`);
    clr(); labO(20); G.x = G.tx = 0.9; for (const s of G.soldiers) s.x = 0.9; addO('wreck', -2.6, -12);
    run(300);
    check('obstacle: steering to the free side avoids a wreck completely', G.phase === 'run' && lostSum() === 0 && G.squad === 20, `${G.phase} lost ${lostSum()}`);
    clr(); labO(6); G.shield = 1e9; addO('log', 0, -10);
    run(260);
    check('obstacle: the mech shield protects the squad', G.phase === 'run' && lostSum() === 0 && G.squad === 6);

    // ---- squeeze into the gap
    clr(); labO(40); addO('wreck', -2.6, -14); addO('wreck', 2.6, -14);
    check('squeeze: no obstacle near -> G.gap is null', G.gap === null && zb.pathBounds().gap === null);
    run(75);
    const gp = G.gap, pb = zb.pathBounds();
    check('squeeze: with obstacles ahead G.gap = the gap that holds the squad centre (obstacle edges + margin), pathBounds().gap is the same', gp && Math.abs(gp.lo + 1.4) < 1e-6 && Math.abs(gp.hi - 1.4) < 1e-6 && pb.gap && pb.gap.lo === gp.lo, JSON.stringify(gp));
    check('squeeze: the formation narrows to the gap (2.8 wide gap minus the 0.5 slack = 4 columns) and every soldier fits in it', pb.cols <= 4 && G.soldiers.every(s => Math.abs(s.x) < 1.4 + 0.05), `${pb.cols} cols, max |x| ${Math.max(...G.soldiers.map(s => Math.abs(s.x))).toFixed(2)}`);
    run(320);
    check('squeeze: a centred squad passes between two wrecks without a loss, then G.gap is null again and the formation widens', G.phase === 'run' && lostSum() === 0 && G.squad === 40 && G.gap === null && zb.pathBounds().cols > 5, `${G.phase} lost ${lostSum()} cols ${zb.pathBounds().cols}`);
    clr(); labO(40); G.x = G.tx = 0; addO('wreck', 0, -14);
    run(60);
    check('squeeze: with the centre inside an obstacle the nearest gap is used', G.gap && (G.gap.hi < -1 || G.gap.lo > 1), JSON.stringify(G.gap));

    // ---- bullets
    clr(); labO(1); G.phase = 'boss';
    const wr = addO('wreck', 0, -15);
    const behind = mk3(0, wr.z - 3, 1000);
    const hp0 = wr.hp;
    check('obstacle hp: a wreck has 420 x (1 + 0.1 (depth - 1)) hp at depth 2 = 462; containers and logs have none (indestructible)', hp0 === Math.round(420 * 1.1) && wr.max === hp0 && addO('container', 2.6, -30).max === 0 && addO('log', -2.6, -30).max === 0, hp0);
    for (let i = 0; i < 60; i++) zb.spawnBullet(0, wr.z + 3, 0, -1, 7, 0, 0);
    for (let i = 0; i < 20; i++) zb.step(1 / 60);
    check('obstacle: bullets stop at a wreck and take hp off it (60 x 7); nothing behind it is hurt', Math.abs(wr.hp - (hp0 - 420)) < 1e-6 && !wr.dead && behind.hp === 1000 && brk.length === 0, `${wr.hp} ${behind.hp}`);
    for (let i = 0; i < 10; i++) zb.spawnBullet(0, wr.z + 3, 0, -1, 7, 0, 0);
    for (let i = 0; i < 30; i++) zb.step(1 / 60);
    check('obstacle: at 0 hp it breaks - dead, one obstacleBreak{x,z,kind}, and the surplus bullets fly on to the zombie behind', wr.dead && wr.hp === 0 && brk.length === 1 && brk[0].kind === 'wreck' && brk[0].x === 0 && brk[0].z === wr.z && behind.hp < 1000 && behind.hp >= 1000 - 4 * 7 - 1e-6, `${brk.length} ${behind.hp}`);
    const ct = G.events.find(e => e.type === 'obstacle' && e.kind === 'container'), behind2 = mk3(2.6, ct.z - 4, 1000);
    for (let i = 0; i < 80; i++) zb.spawnBullet(2.6, ct.z + 4, 0, -1, 7, 0, 0);
    for (let i = 0; i < 30; i++) zb.step(1 / 60);
    check('obstacle: a container is indestructible - it absorbs every shot, never breaks, flashes, and shields the zombie behind it', !ct.dead && ct.hp === 0 && brk.length === 1 && behind2.hp === 1000, `${ct.dead} ${behind2.hp}`);
    check('obstacle: a bullet past the side of an obstacle is not blocked', (() => { const z0 = mk3(-2.6, wr.z - 1, 1000); const lg = G.events.find(e => e.type === 'obstacle' && e.kind === 'log'); lg.z = wr.z - 1; zb.spawnBullet(-0.9, lg.z + 3, 0, -1, 7, 0, 0); for (let i = 0; i < 10; i++) zb.step(1 / 60); return lg.max === 0 && z0.hp === 1000; })(), 'a log at x -2.6 covers -4.1..-1.1: a shot at -0.9 does not touch it');

    // ---- zombies, the mech and the boss ignore obstacles
    clr(); labO(1); G.phase = 'boss'; G.shield = 1e9;
    const cz = addO('container', 0, -9), zz = mk3(0, cz.z - 2.6, 1000);
    zz.sp = 3;
    const zStart = zz.z;
    for (let i = 0; i < 120; i++) zb.step(1 / 60);
    check('obstacles ignore zombies: a zombie walks straight through a container footprint', zz.z > zStart + 3 && zz.z > cz.z + 0.5, `${(zz.z - zStart).toFixed(2)}`);

    // ---- placement: seeded, per scene, rules
    {
      const ids = ['n1', 'n2', 'n3a', 'n3b', 'n4a', 'n4b', 'n5'];
      for (let d = 6; d <= 30; d++) { if (d % 2 === 0) ids.push('p' + d); else ids.push('p' + d + 'a', 'p' + d + 'b'); }
      const SCn7 = zb.SCENES; let sideN = 0, sideBad = 0; let total = 0, rowsBad = 0, nearGun = 0, badSeg = 0, badKind = 0, offLane = 0, closeRows = 0, endBad = 0, nondet = 0, abBad = 0;
      const sigO = () => JSON.stringify(zb.levelObstacles.map(o => [o.kind, o.x, +o.z.toFixed(3), o.hp, o.row]));
      const sigN = () => JSON.stringify(G.events.filter(e => e.type !== 'obstacle').map(e => [e.type, +e.z.toFixed(3), +(e.x || 0).toFixed(3), e.val || 0, e.kind || '', e.spec ? [e.spec.kind, e.spec.count, +e.spec.hp.toFixed(3)] : 0]));
      for (const id of ids) {
        zb.prepareNode(id);
        const obsAll = zb.levelObstacles.slice(), obs = obsAll.filter(o => o.row < 1000), sg = sigO(), sn = sigN();
        total += obs.length;
        for (const sgm of G.route.filter(q => q.type === 'split')) for (const [sk, side] of [['left', -1], ['right', 1]]) {
          const lo = side < 0 ? -3.55 : sgm.split + sgm.margin, hi = side < 0 ? sgm.split - sgm.margin : 3.55;
          const so = obsAll.filter(o => o.row >= 1000 && o.z <= sgm.z0 && o.z > sgm.z1 && (o.x < sgm.split) === (side < 0));
          sideN += so.length;
          if (so.length > sgm[sk].obs) sideBad++;
          for (const o of so) if (o.kind !== SCn7[sgm[sk].scene].obstacle || o.w !== T.splitObsW) sideBad++;
          if (so.length && !zb.obstacleGaps(so, lo, hi, T.obsPad).some(q => q[1] - q[0] >= T.splitMinGap)) sideBad++;
        }
        zb.prepareNode(id); if (sigO() !== sg) nondet++;
        T.obsOn = 0; zb.prepareNode(id); T.obsOn = 1;
        if (zb.levelObstacles.length !== 0 || sigN() !== sn) abBad++;
        zb.prepareNode(id);
        const rows = {};
        for (const o of obs) (rows[o.row] = rows[o.row] || []).push(o);
        for (const r of Object.values(rows)) if (!zb.obstacleGaps(r, -3.55, 3.55, T.obsPad).some(q => q[1] - q[0] >= T.obsMinGap)) rowsBad++;
        const keys = Object.keys(rows).map(Number).sort((a, b) => a - b);
        for (let k = 1; k < keys.length; k++) { const a = rows[keys[k - 1]], b = rows[keys[k]]; const aFar = Math.min(...a.map(o => o.z - o.d / 2)), bNear = Math.max(...b.map(o => o.z + o.d / 2)); if (aFar - bNear < 24) closeRows++; }
        const pickups = G.events.filter(e => e.type === 'weapon' || e.type === 'gate' || e.type === 'hero');
        for (const o of obs) {
          for (const e of pickups) if (o.z + o.d / 2 > e.z - T.obsClear[0] && o.z - o.d / 2 < e.z + T.obsClear[1]) nearGun++;
          for (const dz of [-8, 0, 9]) { const s = zb.segAt(o.z + dz); if (!s || (s.type !== 'straight' && s.type !== 'ambush')) badSeg++; }
          if (o.kind !== zb.SCENES[G.node.scene].obstacle) badKind++;
          if (!zb.LANES.includes(o.x) || o.x === 0) offLane++;           // only the side lanes are ever blocked
          if (o.z - o.d / 2 < -G.L + 20) endBad++;
        }
      }
      check('obstacle placement: seeded - the same node twice gives the same obstacles; obsOn = 0 removes them and leaves every other event exactly as it was', nondet === 0 && abBad === 0, `${nondet} ${abBad}`);
      check('obstacle placement: every row leaves a gap >= obsMinGap (never blocks all 3 lanes), rows are >= 24 apart', rowsBad === 0 && closeRows === 0, `${rowsBad} ${closeRows}`);
      check('obstacle placement: never inside the keep-out zone of a gun row / gate / mech cluster (so a gun row\'s blank lane stays open)', nearGun === 0, nearGun);
      check('obstacle placement: only on straight / ambush ground (never in a narrow, fork, split side, gauntlet or arena), never near the arena', badSeg === 0 && endBad === 0, `${badSeg} ${endBad}`);
      check('obstacle placement: kind follows the scene (SCENES[scene].obstacle), x is a SIDE lane centre (the middle lane is never blocked)', badKind === 0 && offLane === 0 && total > 0, `${badKind} ${offLane} total ${total}`);
      check('split obstacles: each side holds at most its seg.<side>.obs half-width obstacles of its own scene kind, and the side keeps a gap >= splitMinGap', sideBad === 0 && sideN > 0, `${sideBad} bad, ${sideN} placed`);
      check('obstacle placement: n1 (the tutorial) has none', (zb.prepareNode('n1'), zb.levelObstacles.length === 0));
    }
    o1(); o2(); o3();
    zb.resetSave();
  }


  // ================================================================ round 7 step 2: scenes and node-aware plans
  {
    const SCn = zb.SCENES, ND = zb.nodeDef;
    const info = id => { zb.prepareNode(id); return { theme: G.theme, scene: G.scene, name: G.routeName, ahead: G.spawnAhead, route: G.route.slice(), ev: G.events.slice() }; };
    const all = ['n1', 'n2', 'n3a', 'n3b', 'n4a', 'n4b', 'n5'];
    for (let d = 6; d <= 12; d++) { if (d % 2 === 0) all.push('p' + d); else all.push('p' + d + 'a', 'p' + d + 'b'); }
    let bad = '';
    for (const id of all) {
      const q = info(id), nd = ND(id);
      if (q.scene !== nd.scene || q.name !== nd.name) bad += ` ${id} scene/name;`;
      if (!['n1', 'n2', 'n5'].includes(id) && q.theme !== SCn[nd.scene].theme) bad += ` ${id} theme ${q.theme};`;
      if (q.route.some(sg => sg.scene !== nd.scene)) bad += ` ${id} seg.scene;`;
    }
    check('scenes: G.scene = node.scene, G.routeName = node.name, G.theme = the scene theme unless the plan overrides it (n1 dawn, n2 sunset, n5 storm), every segment has seg.scene', bad === '', bad);
    check('scenes: the authored overrides', info('n1').theme === 'dawn' && info('n2').theme === 'sunset' && info('n5').theme === 'storm' && info('n4a').theme === 'night' && info('n3b').theme === 'storm');
    check('plans are node-aware: routePlan(node) differs for the two branches of one depth, routePlan(depth) is the main-path node', zb.routePlan(ND('n3a')).sig !== zb.routePlan(ND('n3b')).sig && zb.routePlan(3) === zb.routePlan(ND('n3a')) && zb.routePlan(4).name === ND('n4a').name && zb.routePlan(ND('p7a')).name === ND('p7a').name);
    // tunnel: shorter release distance, head-on columns
    const tn = info('n4a');
    const hords = tn.ev.filter(e => e.type === 'horde' && !e.ahead && e.z < -30);
    check('tunnel: hordes are released 34 ahead (G.spawnAhead), other scenes 58; ambush hordes keep their own distance', tn.ahead === 34 && info('n3b').ahead === T.spawnAhead && info('n1').ahead === T.spawnAhead && info('n3a').ev.filter(e => e.ahead).every(e => e.ahead === T.ambushAhead));
    check('tunnel: every horde outside a narrow is one head-on column (cx 0, at most 5 wide)', hords.length > 3 && hords.every(e => { const sg = tn.route.find(q => e.z <= q.z0 && e.z > q.z1); return sg.type === 'narrow' || (e.spec.cx === 0 && e.spec.w <= 5 + 1e-9); }), hords.length);
    (() => {                                          // a horde really appears only when the squad is 34 away
      zb.prepareNode('n4a'); zb.start();
      for (const e of G.events) { if (e.type === 'gate') e.used = true; else if (e.type === 'weapon') e.taken = true; else if (e.type === 'hero') e.missed = true; }
      const h = G.events.filter(e => e.type === 'horde' && !e.ahead).sort((a, b) => b.z - a.z)[3];
      G.shield = 1e9; G.z = h.z + 40; for (let i = 0; i < 3; i++) zb.step(1 / 60);
      const before = h.spawned;
      G.z = h.z + 33; zb.step(1 / 60);
      check('tunnel: a horde is not released at 40 units but is at 33', !before && h.spawned === true, `${before} ${h.spawned}`);
    })();
    // scene fx on the horde numbers
    const keepNode = G.node;
    const sp = (id, kind, n) => { G.node = ND(id); const r = zb.hordeSpec(kind, n, 1, 0.5); return r; };
    const rh = sp('n5', 'runners', 5), rb = sp('n2', 'runners', 5);
    check('highway: runner packs are 1.3x bigger and 1.1x faster than on a bridge', Math.abs(rh.count / rb.count - 1.3) < 0.06 && Math.abs(rh.fast / rb.fast - 1.1) < 1e-9, `${rh.count} ${rb.count}`);
    const bf = sp('n4b', 'brutes', 4), bh = sp('n3b', 'brutes', 4);
    check('forest: brute groups are SCENES.forest.fx.bruteMul bigger', Math.abs(bf.count / bh.count - zb.SCENES.forest.fx.bruteMul) < 0.15, `${bf.count} ${bh.count}`);
    G.node = keepNode;
    const barrels = id => info(id).ev.filter(e => e.type === 'barrel').length;
    const bc = barrels('n3a'), others = [barrels('n3b'), barrels('n4b'), barrels('n2')];
    check('city: more explosive barrels than the other scenes of the same size', others.every(q => bc > q), bc + ' vs ' + others.join('/'));
    check('city: alley ambushes - hordes released late in left / right pairs', info('n3a').ev.filter(e => e.type === 'horde' && e.ahead).length >= 4);
    // harbor / forest / highway obstacle kinds (obstacles per node)
    const kinds = id => { zb.prepareNode(id); return new Set(zb.levelObstacles.filter(o => o.row < 1000).map(o => o.kind)); };
    check('obstacles per scene: city/tunnel barriers, harbor containers, forest logs, highway/bridge wrecks; every authored node from n2 on has some', [['n2', 'wreck'], ['n3a', 'barrier'], ['n3b', 'container'], ['n4a', 'barrier'], ['n4b', 'log'], ['n5', 'wreck']].every(([id, k]) => { const kk = kinds(id); return kk.size === 1 && kk.has(k); }));
    check('obstacles: harbor containers come as narrows - pairs that leave one lane free, 1-3 deep', (() => { zb.prepareNode('n3b'); const o = zb.levelObstacles; const rows = {}; for (const q of o) (rows[q.row] = rows[q.row] || []).push(q); return Object.values(rows).every(r => r.length % 2 === 0 && r.length <= 6); })());
    check('plans: the same node gives the same plan and the same events twice (determinism incl. scene effects)', all.every(id => { zb.prepareNode(id); const a = sig(); zb.prepareNode(id); return a === sig(); }));
    zb.prepareNode('n1');
  }


  // ================================================================ round 7 step 4: split segments
  {
    const SCn = zb.SCENES;
    const labS = id => {                                 // running, nothing spawns or triggers, the squad stands where we put it
      zb.prepareNode(id); zb.start();
      for (const e of G.events) { if (e.type === 'horde') e.spawned = true; else if (e.type === 'gate') e.used = true; else if (e.type === 'weapon') e.taken = true; else if (e.type === 'hero') e.missed = true; }
      G.squad = 30; zb.syncSoldiers(); G.shield = 1e9;
      for (const s of G.soldiers) s.cd = 1e9;
    };
    const mkS = (x, z, hp) => { zb.spawnHorde({ kind: 'lab', cx: x, w: 0, d: 0, count: 1, hp }, z); const q = Z[Z.length - 1]; q.x = x; q.sp = 0; q.hp = hp; return q; };
    const splitsOf = id => { zb.prepareNode(id); return G.route.filter(q => q.type === 'split'); };
    const sp2 = splitsOf('n2'), sp5 = splitsOf('n5');
    check('split: n2 and n5 each have exactly one split; n2 also keeps a fork', sp2.length === 1 && sp5.length === 1 && (zb.prepareNode('n2'), G.route.filter(q => q.type === 'fork').length === 1));
    const sg0 = sp2[0];
    check('split: seg has split (median x = 0), margin 0.6, left.scene / right.scene (two different known scenes), scene = the node scene', sg0.split === 0 && sg0.margin === T.splitMargin && SCn[sg0.left.scene] && SCn[sg0.right.scene] && sg0.left.scene !== sg0.right.scene && sg0.scene === 'bridge', JSON.stringify([sg0.left, sg0.right]));
    check('split: left is tunnel-like (dense head-on hordes), right harbor-like (containers and barrels)', sg0.left.scene === 'tunnel' && sg0.right.scene === 'harbor' && sg0.left.dense === T.splitDense);
    // contents
    {
      zb.prepareNode('n2'); const sg = G.route.find(q => q.type === 'split');
      const inS = G.events.filter(e => e.z <= sg.z0 && e.z > sg.z1);
      const sideOf = e => ((e.type === 'horde' ? e.spec.cx : e.x) >= sg.split ? 1 : -1);
      const hordes = side => inS.filter(e => e.type === 'horde' && sideOf(e) === side), obsS = side => inS.filter(e => e.type === 'obstacle' && sideOf(e) === side);
      const bars = side => inS.filter(e => e.type === 'barrel' && sideOf(e) === side).length;
      const hl = hordes(-1), hr = hordes(1);
      check('split contents: both sides have hordes (cx on their own side) and a gate, no gun rows inside', hl.length && hr.length && hl.every(e => e.spec.cx < 0) && hr.every(e => e.spec.cx > 0) && inS.filter(e => e.type === 'gate').length === 2 && !inS.some(e => e.type === 'weapon'));
      check('split contents: the left side has no obstacles and fewer barrels, the right side has 2 containers (half-width) and barrels', obsS(-1).length === 0 && bars(-1) < bars(1) && obsS(1).length === 2 && obsS(1).every(o => o.kind === 'container' && o.w === T.splitObsW) && bars(1) >= 2, `${obsS(-1).length} ${bars(-1)} ${obsS(1).length} ${bars(1)}`);
      const avgDense = hl.reduce((a, e) => a + e.spec.count, 0) / hl.length;
      const lp = zb.routePlan(zb.nodeDef('n2')).segs.find(q => q.type === 'split').left; lp.dense = 1; zb.prepareNode('n2');
      const sgB = G.route.find(q => q.type === 'split'); const hl0 = G.events.filter(e => e.type === 'horde' && e.z <= sgB.z0 && e.z > sgB.z1 && e.spec.cx < 0);
      lp.dense = T.splitDense; zb.prepareNode('n2');
      check('split contents: dense - the left side hordes are bigger than the same hordes without density (seg.left.dense)', hl0.length === hl.length && avgDense > hl0.reduce((a, e) => a + e.spec.count, 0) / hl0.length, `${avgDense}`);
    }
    // commit and clamp
    for (const [startX, want, label] of [[2.0, 1, 'right'], [-2.0, -1, 'left']]) {
      labS('n2');
      const sg = G.route.find(q => q.type === 'split');
      const ev = []; const off = listen('splitChosen', ev);
      const rs = []; const off2 = listen('routeSegment', rs);
      G.z = sg.z0 + 3; G.x = G.tx = startX; for (const s of G.soldiers) s.x = startX;
      for (let i = 0; i < 4; i++) zb.step(1 / 60);
      for (let i = 0; i < 90 && G.z > sg.z0 - 1; i++) { G.shield = 1e9; zb.step(1 / 60); }
      off(); off2();
      check(`split: entering on the ${label} locks that half (seg.chosen = ${want}); bus splitChosen { seg, side, scene } follows routeSegment`, sg.chosen === want && ev.length === 1 && ev[0].seg === sg && ev[0].side === want && ev[0].scene === (want > 0 ? sg.right.scene : sg.left.scene) && rs.some(q => q.seg === sg && q.index === G.route.indexOf(sg)), `${sg.chosen} ${ev.length}`);
      G.tx = -want * 3.5; for (let i = 0; i < 90; i++) { G.shield = 1e9; zb.step(1 / 60); }
      const xs = G.soldiers.map(s => s.x);
      const ok = want > 0 ? Math.min(...xs) >= sg.split + sg.margin - 0.1 : Math.max(...xs) <= sg.split - sg.margin + 0.1;
      check(`split: the ${label} squad cannot cross the median (0.6 wide wall), formation included`, ok && G.z > sg.z1 && (want > 0 ? G.x >= sg.split + sg.margin : G.x <= sg.split - sg.margin), `x ${G.x.toFixed(2)} ${Math.min(...xs).toFixed(2)}..${Math.max(...xs).toFixed(2)}`);
      const zl = mkS(-1.0, G.z - 5, 100), zr = mkS(1.0, G.z - 5, 100); zl.sp = zr.sp = 0.3;
      for (let i = 0; i < 60; i++) { G.shield = 1e9; zb.step(1 / 60); }
      if (want > 0) check('split: zombies stay on their own side (the 0.6 wall)', zl.x <= -sg.margin + 1e-6 && zr.x >= sg.margin - 1e-6, `${zl.x.toFixed(2)} ${zr.x.toFixed(2)}`);
      G.z = sg.z1 - 14; for (let i = 0; i < 90; i++) { G.tx = -want * 3.5; G.shield = 1e9; zb.step(1 / 60); }       // (the pointer keeps dragging: the rail around a side obstacle may overwrite a one-off tx)
      check(`split: after the split the full deck is back (${label})`, want > 0 ? G.x < sg.split : G.x > sg.split, `x ${G.x.toFixed(2)}`);
    }
    // a side obstacle: squeeze inside the half, no loss for a squad in the gap
    {
      labS('n2'); const sg = G.route.find(q => q.type === 'split');
      const ob = zb.levelObstacles.filter(o => o.row >= 1000 && o.z <= sg.z0 && o.z > sg.z1)[0];
      G.shield = 0; G.squad = 30; zb.syncSoldiers(); for (const s of G.soldiers) s.cd = 1e9;
      G.z = sg.z0 + 3; G.x = G.tx = 2.0; for (const s of G.soldiers) s.x = 2.0;
      for (let i = 0; i < 10; i++) zb.step(1 / 60);
      for (let i = 0; i < 60 && G.z > sg.z0 - 1; i++) zb.step(1 / 60);
      G.z = ob.z + 14;
      const squad0 = G.squad; let sawGap = null, minCols = 99;
      const hitsS = []; const off = listen('obstacleHit', hitsS);
      for (let i = 0; i < 400 && G.z > ob.z - 8 && G.phase === 'run'; i++) {
        if (G.gap) { sawGap = sawGap || { lo: G.gap.lo, hi: G.gap.hi }; G.tx = (G.gap.lo + G.gap.hi) / 2; minCols = Math.min(minCols, zb.pathBounds().cols); }
        zb.step(1 / 60);
      }
      off();
      check('split side obstacle: the squeeze works inside the half - G.gap lies within the side, >= splitMinGap wide, the formation narrows to it, and steering to its middle loses nobody', sawGap && sawGap.lo >= sg.split + sg.margin - 1e-6 && sawGap.hi - sawGap.lo >= T.splitMinGap && minCols <= Math.floor((sawGap.hi - sawGap.lo) / 0.62) + 1 && hitsS.length === 0 && G.squad === squad0, JSON.stringify(sawGap) + ` cols ${minCols} hits ${hitsS.length}`);
    }
    // procedural splits
    {
      let n = 0, total = 0, bad = '';
      for (let d = 6; d <= 41; d++) for (const id of (d % 2 === 0 ? ['p' + d] : ['p' + d + 'a', 'p' + d + 'b'])) {
        total++;
        const ss = splitsOf(id);
        if (ss.length) n++;
        for (const q of ss) { if (q.left.scene === q.right.scene || !SCn[q.left.scene] || !SCn[q.right.scene] || q.left.scene !== G.node.scene) bad += ' ' + id; }
      }
      check('split: procedural nodes sometimes (not mostly) have a split; its two sides are two different scenes, the left one the node scene', n >= 5 && n < total * 0.7 && bad === '', `${n}/${total}${bad}`);
    }
    zb.prepareNode('n1'); zb.resetSave();
  }


  // ================================================================ round 7 step 6: event order and the synchronous map select (front-end agreement)
  {
    zb.resetSave();
    const order = [], offs = ['nodeCleared', 'nodeUnlocked', 'stageResult', 'win'].map(nm => listen(nm, { push: () => order.push(nm) }));
    zb.startNode('n1'); G.squad = 25; zb.syncSoldiers(); G.shield = 1e9; skipToBoss();
    let guard = 0; while (G.phase !== 'win' && guard++ < 8000) { G.shield = 1e9; zb.step(1 / 60); }
    offs.forEach(f => f());
    check('events: nodeCleared, then nodeUnlocked (before the result screen), then stageResult, then win', order.join() === 'nodeCleared,nodeUnlocked,stageResult,win', order.join());
    zb.bus.emit('mapSelect', { id: 'n2' });
    check('mapSelect{id} prepares the node synchronously: G.node, G.scene and G.level are set before emit returns, phase menu', G.node.id === 'n2' && G.scene === 'bridge' && G.level === 2 && G.phase === 'menu');
    zb.bus.emit('mapSelect', { id: 'n3a' });
    check('mapSelect of a locked node changes nothing', G.node.id === 'n2');
    const mn = zb.mapNodes();
    check('mapNodes fields: id, state, stars, entry, cleared, x, y, next, name, scene, depth, diffMul, coinMul', mn.every(q => ['id', 'state', 'stars', 'entry', 'cleared', 'x', 'y', 'next', 'name', 'scene', 'depth', 'diffMul', 'coinMul'].every(k => k in q)) && ['locked', 'open', 'cleared'].includes(mn[0].state));
    check('procedural ids: p<d> for a single node (even depth), p<d>a / p<d>b for a two-way branch (odd depth)', zb.nodeDef('p6') && zb.nodeDef('p6').next.join() === 'p7a,p7b' && zb.nodeDef('p7a') && zb.nodeDef('p7b') && zb.nodeDef('p7') === null && zb.nodeDef('p8a') === null);
    zb.resetSave(); zb.prepareNode('n1');
  }

  T.critBase = crit0;
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
