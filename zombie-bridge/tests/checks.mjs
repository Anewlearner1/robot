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
  const skipToBoss = () => { for (const e of G.events) if (e.type === 'gate') e.used = true; G.z = -G.L + 2; };
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
    check('pair: the two guns are side by side (<= 2 in a row) and different', pairA.mate.mate === pairA && pairA.w !== pairA.mate.w && Math.abs(pairA.x - pairA.mate.x) >= 3 && G.events.filter(e => e.type === 'weapon' && e.z === pairA.z).length === 2);
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
    zb.spawnBullet(0, -1, 0, -1, 4, 0, 6);              // rocket: splash 1.6
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
    for (let i = 0; i < 22; i++) zb.step(1 / 60);       // 0.37 s: sniper (0.32 s) and shotgun (0.32 s) are gone, rocket (0.9 s) and rifle (0.56 s) are not
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
    const h = () => { winsBefore = log.length; coinsAtEvent = zb.SAVE.coins; runCoins = G.coins; entryAtEvent = zb.SAVE.stages[n + 1] && zb.SAVE.stages[n + 1].entry; };
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
    zb.SAVE.coins = 123; zb.SAVE.upgrades.dmg = 2; zb.SAVE.best = 3; zb.SAVE.stages[2] = { entry: 37, stars: 2 };
    zb.saveGame();
    const raw = JSON.parse(localStorage.getItem(KEY));
    check('save: round trip, the stored JSON has coins / upgrades / best / stages[n].entry+stars', raw.coins === 123 && raw.upgrades.dmg === 2 && raw.best === 3 && raw.stages[2].entry === 37 && raw.stages[2].stars === 2, JSON.stringify(raw));
    zb.SAVE.coins = 0; zb.SAVE.upgrades = {}; zb.SAVE.stages = {}; zb.SAVE.best = 1;
    zb.loadSave();
    check('save: loadSave restores the same state', zb.SAVE.coins === 123 && zb.SAVE.upgrades.dmg === 2 && zb.SAVE.best === 3 && zb.entryFor(2) === 37 && zb.SAVE.stages[2].stars === 2, JSON.stringify(zb.SAVE));
    localStorage.setItem(KEY, '{broken json');
    let threw = false; try { zb.loadSave(); } catch (e) { threw = true; }
    check('save: a corrupt save does not throw, falls back to a fresh one', !threw && zb.SAVE.coins === 0 && zb.entryFor(2) === T.startSquad);
    localStorage.setItem(KEY, JSON.stringify({ v: 1, coins: -5, best: 2, upgrades: { dmg: 99 }, stages: { 2: { entry: 9999, stars: 9 } } }));
    zb.loadSave();
    check('save: out-of-range values are clamped', zb.SAVE.coins === 0 && zb.SAVE.upgrades.dmg === zb.UPGRADES[0].max && zb.entryFor(2) === T.maxSquad && zb.SAVE.stages[2].stars === 3, JSON.stringify(zb.SAVE));
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
    zb.SAVE.stages[2] = { entry: 37, stars: 0 }; zb.saveGame();
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
    check('loss: the stored entry is untouched', zb.SAVE.stages[2].entry === 37 && zb.SAVE.stages[3] === undefined);
    zb.startStage(2);
    check('retry: the same stage starts with the same entry squad again', G.squad === 37 && G.entrySquad === 37 && G.coins === 0);

    // a won run: survivors become the next entry (the larger is kept), stars, coin payout, SAVE written before stageResult
    zb.resetSave();
    let w = playWin(1, 25);
    check('win: one stageResult (before the win event), one win, phase win', w.n === 1 && w.wins === 1 && w.winsBefore === 0 && w.phase === 'win', `${w.n} ${w.wins} ${w.phase}`);
    check('win: survivors are stored as the entry squad of stage 2 and SAVE was already updated when stageResult fired', zb.SAVE.stages[2].entry === 25 && w.entryAtEvent === 25 && w.r.survivors === 25, `${zb.SAVE.stages[2].entry} ${w.entryAtEvent}`);
    check('win: stage 1 entry 1, 25 survivors = 3 stars; coins = run coins + stars*stage*starCoins, wallet += coins (SAVE updated before the event)', w.r.entry === 1 && w.r.stars === 3 && w.r.bonus === 3 * 1 * T.starCoins && w.r.coins === w.runCoins + w.r.bonus && zb.SAVE.coins === w.r.coins && w.coinsAtEvent === w.r.coins && zb.SAVE.stages[1].stars === 3, JSON.stringify(w.r));
    check('win: best unlocks the next stage', zb.SAVE.best === 2);
    w = playWin(1, 12);
    check('win again with fewer survivors: the larger entry (25) is kept', zb.SAVE.stages[2].entry === 25, zb.SAVE.stages[2].entry);
    // stars: 1 clear, 2 if survivors >= entry, 3 if >= max(1.5 x entry, entry + 10)
    zb.resetSave(); zb.SAVE.stages[2] = { entry: 20, stars: 0 };
    const sv = n => { zb.SAVE.stages[2] = { entry: 20, stars: 0 }; return playWin(2, n).r.stars; };
    const st = [sv(19), sv(20), sv(29), sv(30)];
    check('stars: entry 20 -> 19 survivors 1 star, 20 -> 2, 29 -> 2, 30 -> 3', st.join() === '1,2,2,3', st.join());
    zb.SAVE.stages[2] = { entry: 50, stars: 0 };
    const hi = [playWin(2, 49).r.stars, playWin(2, 50).r.stars, playWin(2, 60).r.stars];
    check('stars: the 3-star bar is capped by the squad limit (entry 50: 60 survivors = 3)', hi.join() === '1,2,3', hi.join());
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
      zb.spawnBullet(x0, z0, dx, dz, 7, 0, w);
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
    const find = kind => { for (let sNo = 1; sNo <= 6; sNo++) { zb.prepare(sNo); const g = G.events.find(e => e.type === 'gate' && e.kind === kind); if (g) return sNo; } return 0; };
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
    zb.SAVE.stages[2] = { entry: 30, stars: 0 };
    zb.startStage(2);
    const sm2 = []; const k5 = listen('squadMilestone', sm2);
    G.shield = 1e9; zb.step(1 / 60); G.squad = 55; zb.syncSoldiers(); zb.step(1 / 60); zb.step(1 / 60);
    k5();
    check('squad milestones: only those above the entry squad count in a run (entry 30 -> just 50)', sm2.map(m => m.n).join() === '50', sm2.map(m => m.n).join());
    zb.resetSave();
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
