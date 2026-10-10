// CPU micro-benchmark for the simulation step: a stress scene with ~600 zombies, 40 gatling soldiers and a mech.
// Only step() is timed (rendering under SwiftShader says nothing about phone CPU cost).
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_THREE = '/tmp/claude-0/-home-user-robot/e63d82bf-e5cf-557e-842c-86e09e28f838/scratchpad/vendor/three.min.js';
const three = process.env.THREE_JS || DEFAULT_THREE;
const html = process.env.ZB_HTML || path.resolve(here, '../index.html');
const STEPS = Number(process.env.STEPS || 1500);
const ZOMBIES = Number(process.env.ZOMBIES || 600);
const THROTTLE = Number(process.env.CPU_THROTTLE || 1);   // e.g. 4 = emulate a ~4x slower phone CPU
const SPREAD = Number(process.env.SPREAD || 20);          // depth (z units) the horde is packed into: smaller = denser = worse case
const BATCH = 20;                                          // performance.now() is only 0.1 ms precise: time batches of steps

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-precise-memory-info'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
await page.addInitScript(() => { window.requestAnimationFrame = () => 0; });
await page.route('**/three.min.js', r => r.fulfill({ body: fs.readFileSync(three), contentType: 'application/javascript' }));
await page.route('https://fonts.**', r => r.abort());
await page.goto('file://' + html);
await page.waitForFunction(() => window.__zb);
await page.evaluate(() => document.getElementById('mute').click());
if (THROTTLE > 1) { const cdp = await page.context().newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE }); }

const res = await page.evaluate(({ STEPS, ZOMBIES, BATCH, SPREAD }) => {
  const zb = window.__zb, G = zb.G, Z = zb.Z;
  let seed = 12345;
  Math.random = () => { seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  zb.prepare(3);
  zb.start();
  G.squad = 40; G.weapon = 3; G.shield = 1e9; zb.syncSoldiers();
  const hero = G.events.find(e => e.type === 'hero');
  zb.activateHero(hero);
  // keep the pressure constant: top the horde up to ZOMBIES every step, tanky enough to survive the whole run
  const topUp = () => {
    G.squad = 40; G.shield = 1e9;
    if (G.z < -150) G.z = 0;
    const need = ZOMBIES - Z.length;
    if (need > 0) zb.spawnHorde({ cx: 0, w: 7.4, d: SPREAD, count: need, hp: 40 }, G.z - 3);
  };
  const times = [];
  for (let i = 0; i < 200; i++) { topUp(); zb.step(1 / 60); }            // warm-up (JIT)
  const allocs = [];
  for (let b = 0; b < STEPS / BATCH; b++) {
    let tt = 0;
    const h0 = performance.memory.usedJSHeapSize;
    for (let i = 0; i < BATCH; i++) {
      topUp();
      const t0 = performance.now();
      zb.step(1 / 60);
      tt += performance.now() - t0;
    }
    times.push(tt / BATCH);
    const h1 = performance.memory.usedJSHeapSize;
    if (h1 >= h0) allocs.push((h1 - h0) / BATCH);       // topUp allocates too (the spawned zombies), so this over-counts a little
    zb.pops.length = 0; document.getElementById('pops').textContent = '';
  }
  times.sort((a, b) => a - b);
  const sum = times.reduce((a, b) => a + b, 0);
  return {
    zombies: Z.length, soldiers: G.soldiers.length, mech: !!G.mech, phase: G.phase, squad: G.squad,
    meanMs: sum / times.length, p50: times[times.length >> 1], p95: times[Math.floor(times.length * 0.95)], p99: times[Math.floor(times.length * 0.99)], max: times[times.length - 1],
    // heap growth per step (steps with a GC in between are dropped, so this is a lower bound)
    allocMeanKB: allocs.length ? allocs.reduce((a, b) => a + b, 0) / allocs.length / 1024 : 0,
  };
}, { STEPS, ZOMBIES, BATCH, SPREAD });

console.log(JSON.stringify(res, (k, v) => typeof v === 'number' ? Math.round(v * 1000) / 1000 : v));
console.log(`step ms (per-step mean of 20-step batches; throttle x${THROTTLE}): mean ${res.meanMs.toFixed(3)}  p50 ${res.p50.toFixed(3)}  p95 ${res.p95.toFixed(3)}  p99 ${res.p99.toFixed(3)}  max ${res.max.toFixed(3)}   heap alloc/step ~${res.allocMeanKB.toFixed(1)} KB`);
console.log('page errors: ' + errors.length);
if (errors.length) console.log(errors.slice(0, 5).join('\n'));
await browser.close();
process.exit(errors.length ? 1 : 0);
