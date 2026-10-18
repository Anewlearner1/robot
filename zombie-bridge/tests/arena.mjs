// Weapon arena: every gun against the same set of scripted encounters, with a fixed squad standing still.
// Shows what each gun is good at (and what it is bad at), independent of level layout and bot behaviour.
//   node arena.mjs [--cap 1] [--still 1] [--squad 8] [--mult 3] [--lv 1] [--trials 12] [--stage 2] [--json out.json]
// --tune '{...}' overrides TUNE / WEAPONS.i.key; --only boss,wall limits the columns. --cap 1 prints capacity instead: the horde size (x the base horde) the squad can stop losing <= 25 %. Higher is better.
// Cell = soldiers lost / seconds to clear (L = squad wiped, T = not cleared in 30 s). Lower is better.
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_THREE = '/tmp/claude-0/-home-user-robot/e63d82bf-e5cf-557e-842c-86e09e28f838/scratchpad/vendor/three.min.js';
const args = {};
for (let i = 2; i < process.argv.length; i++) if (process.argv[i].startsWith('--')) { args[process.argv[i].slice(2)] = process.argv[i + 1]; i++; }
const CAP = args.cap === '1', STILL = args.still === '1', MULT = Number(args.mult || 3), SQUAD = Number(args.squad || 8), LV = Number(args.lv || 1), TRIALS = Number(args.trials || 12), STAGE = Number(args.stage || 2);
const TUNE_ARG = args.tune ? JSON.parse(args.tune) : {};
const ONLY = args.only ? args.only.split(',') : null;
const three = process.env.THREE_JS || DEFAULT_THREE;
const html = process.env.ZB_HTML || path.resolve(here, '../index.html');

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 200, height: 200 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
await page.addInitScript(() => { window.requestAnimationFrame = () => 0; });
await page.route('**/three.min.js', r => r.fulfill({ body: fs.readFileSync(three), contentType: 'application/javascript' }));
await page.route('https://fonts.**', r => r.abort());
await page.goto('file://' + html);
await page.waitForFunction(() => window.__zb);
await page.evaluate(() => document.getElementById('mute').click());

const out = await page.evaluate(({ SQUAD, LV, TRIALS, STAGE, MULT, STILL, CAP, TUNE_ARG, ONLY }) => {
  const zb = window.__zb, G = zb.G, Z = zb.Z, W = zb.WEAPONS;
  let seed = 4242;
  const reseed = s => { seed = s; };
  Math.random = () => { seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  for (const [k, v] of Object.entries(TUNE_ARG)) {
    const parts = k.split('.'); let o = parts[0] === 'WEAPONS' ? zb : zb.TUNE;
    for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]];
    o[parts[parts.length - 1]] = v;
  }
  const hp = 1 + (STAGE - 1) * zb.TUNE.hpPerStage;
  const scen = [
    ['wall',   { kind: 'wall',   cx: 2.1, w: 3.4, d: 14, count: 90, hp: hp * 2 }],
    ['blob',   { kind: 'blob',   cx: 0,   w: 3.6, d: 6,  count: 70, hp: hp * 2 }],
    ['line',   { kind: 'line',   cx: 0,   w: 7.4, d: 2.6, count: 45, hp: hp * 2 }],
    ['swarm',  { kind: 'swarm',  cx: 0,   w: 7.4, d: 12, count: 40, hp: 1 }],
    ['runners', { kind: 'runners', cx: 0, w: 7.4, d: 5, count: 30, hp: hp * 1.2, fast: 1.9 }],
    ['brutes', { kind: 'brutes', cx: 0,   w: 6.4, d: 4,  count: 6, hp: 45, big: true }],
    ['boss',   null],
  ];
  const run = (g, spec) => {
    zb.TUNE.count.open = 0;                   // no opening horde: the arena spawns its own
    zb.prepare(STAGE); zb.start();
    for (const e of G.events) { if (e.type === 'horde') e.spawned = true; else if (e.type === 'gate') { e.used = true; e.grp.visible = false; } else if (e.type === 'weapon') e.taken = true; else if (e.type === 'hero') e.missed = true; }
    G.squad = SQUAD; zb.syncSoldiers(); G.weapon = g; G.weaponLv = LV;
    const start = G.squad;
    if (spec) {
      if (STILL) G.phase = 'boss';            // stationary squad (no boss object): the horde walks up to it. Default: the squad runs into the horde
      zb.spawnHorde({ ...spec, count: Math.max(1, Math.round(spec.count * MULT)) }, G.z - (STILL ? 14 : 34));
    } else {
      G.z = -G.L + 0.01;                      // the run ends: the boss spawns on the next step
    }
    let t = 0, cleared = null;
    while (t < 30 && G.phase !== 'over' && G.phase !== 'win') {
      zb.step(1 / 60); t += 1 / 60;
      zb.pops.length = 0;
      if (spec && Z.length === 0) { cleared = t; break; }
      if (!spec && G.boss && !G.boss.alive) { cleared = t; break; }
    }
    return { lost: start - G.squad, t: cleared, dead: G.phase === 'over' };
  };
  const res = {};
  const cell = (g, spec, mult, trials) => {
    let lost = 0, tt = 0, ok = 0, dead = 0;
    for (let k = 0; k < trials; k++) {
      reseed(1000 + k * 17 + g);
      const r = run(g, spec ? { ...spec, count: Math.max(1, Math.round(spec.count * mult)) } : null);
      lost += r.lost; if (r.t !== null) { tt += r.t; ok++; } if (r.dead) dead++;
    }
    return { lost: lost / trials, t: ok ? tt / ok : null, cleared: ok / trials, dead: dead / trials };
  };
  for (let g = 0; g < W.length; g++) {
    res[W[g].id] = {};
    for (const [name, spec] of scen) {
      if (ONLY && !ONLY.includes(name)) { res[W[g].id][name] = { lost: 0, t: 0, cleared: 0, dead: 0 }; continue; }
      if (!spec) { res[W[g].id][name] = cell(g, null, 1, TRIALS); continue; }
      if (!CAP) { res[W[g].id][name] = cell(g, spec, MULT, TRIALS); continue; }
      // capacity: the biggest horde multiple (of the stage-2 base horde) this squad stops with at most a quarter of it lost
      let lo = 0.1, hi = 12;
      for (let it = 0; it < 9; it++) {
        const mid = Math.sqrt(lo * hi);
        const r = cell(g, spec, mid, Math.max(3, TRIALS >> 1));
        if (r.lost <= SQUAD * 0.25 && r.dead < 0.5) lo = mid; else hi = mid;
      }
      res[W[g].id][name] = { lost: lo, t: 0, cleared: 1, dead: 0, cap: lo };
    }
  }
  return res;
}, { SQUAD, LV, TRIALS, STAGE, MULT, STILL, CAP, TUNE_ARG, ONLY });

const cols = ['wall', 'blob', 'line', 'swarm', 'runners', 'brutes', 'boss'].filter(c => !ONLY || ONLY.includes(c));
const cellTxt = c => c.cap !== undefined ? 'x' + c.cap.toFixed(2) : c.dead >= 0.5 ? 'L' : c.cleared < 0.5 ? 'T' : `${c.lost.toFixed(1)}/${c.t.toFixed(1)}`;
console.log(`arena: squad ${SQUAD} at Lv${LV}, hordes x${MULT}, stage ${STAGE} numbers, ${TRIALS} trials. cell = ${CAP ? 'capacity (x base horde, higher is better; boss: lost/seconds)' : 'soldiers lost / seconds to clear'}`);
console.log('gun'.padEnd(9) + cols.map(c => c.padEnd(10)).join(''));
for (const [g, r] of Object.entries(out)) console.log(g.padEnd(9) + cols.map(c => cellTxt(r[c]).padEnd(10)).join(''));
console.log('best per column:');
const rank = c => Object.entries(out).filter(([, r]) => r[c].cleared >= 0.5).sort((a, b) => CAP && c !== 'boss' ? b[1][c].cap - a[1][c].cap : (a[1][c].lost - b[1][c].lost) || (a[1][c].t - b[1][c].t));
console.log(cols.map(c => c + ': ' + (rank(c)[0] || ['-'])[0]).join('   '));
if (args.json) fs.writeFileSync(args.json, JSON.stringify(out, null, 1));
console.log('page errors: ' + errors.length);
if (errors.length) console.log(errors.slice(0, 5).join('\n'));
await browser.close();
process.exit(errors.length ? 1 : 0);
