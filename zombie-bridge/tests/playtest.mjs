// Headless balance playtest for 屍潮斷橋.
// Loads index.html in Chromium, then fast-forwards the simulation with window.__zb.step(1/60) inside one
// page.evaluate per attempt, driven by a heuristic bot. See README.md for usage.
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_THREE = '/tmp/claude-0/-home-user-robot/e63d82bf-e5cf-557e-842c-86e09e28f838/scratchpad/vendor/three.min.js';

// ------------------------------------------------------------------ CLI
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (!a.startsWith('--')) continue;
  const k = a.slice(2);
  const nxt = process.argv[i + 1];
  if (nxt === undefined || nxt.startsWith('--')) args[k] = true; else { args[k] = nxt; i++; }
}
const opt = {
  stages: String(args.stages || '1,2,3').split(',').map(Number),
  n: Number(args.n || 40),
  seed: Number(args.seed || 1),
  opening: String(args.opening || 'auto'),         // auto | rifle | gate | battery | weapons | all | allw (all + weapons)
  workers: Number(args.workers || 4),
  three: String(args.three || process.env.THREE_JS || DEFAULT_THREE),
  html: String(args.html || process.env.ZB_HTML || path.resolve(here, '../index.html')),
  json: args.json ? String(args.json) : null,
  dump: args.dump ? String(args.dump) : null,        // write every attempt's raw result here
  maxSeconds: Number(args.max || 240),             // game seconds before an attempt is declared a timeout
  dodge: args.dodge !== undefined ? Number(args.dodge) : 1,   // bot dodge strength (0 = never dodge)
  tune: args.tune ? JSON.parse(String(args.tune)) : {},   // e.g. --tune '{"gatePerSquad":1.5,"count.open":8}' overrides __zb.TUNE (dotted keys reach nested objects)
  holdTake: !!args['hold-take'],                       // with --hold: still pick up other guns' crates for the recruits (the held gun is handed back)
  hold: args.hold !== undefined ? String(args.hold) : null,   // force one gun for the whole run: index, id, or 'all' (one row per gun)
  noise: args.noise !== undefined ? Number(args.noise) : 1,   // human imperfection: 0 = perfect bot, 1 = decent human, 2 = sloppy
  line: !!args.line,                                 // one-line summary per row instead of the table (for sweeps)
  quiet: !!args.quiet,
  trace: !!args.trace,                               // print a coarse timeline for the first attempts of each row
};
if (!fs.existsSync(opt.three)) { console.error('three.min.js not found: ' + opt.three + ' (use --three or THREE_JS)'); process.exit(2); }

// ------------------------------------------------------------------ the bot (runs inside the page)
// Self-contained: Playwright serialises this function and executes it in the page. One call = one full attempt.
function botRun(cfg) {
  const zb = window.__zb, G = zb.G, Z = zb.Z;
  const ROAD = 4, RUN = 4.6, SP = 0.62;
  const WP = zb.WEAPONS;

  // deterministic Math.random for this attempt
  let s = cfg.seed | 0;
  Math.random = function () {
    s = s + 0x6D2B79F5 | 0;
    let t = Math.imul(s ^ s >>> 15, 1 | s);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };

  // event log (hooks are installed once per page, the log object is reset per attempt)
  if (!window.__botHooks) {
    window.__botHooks = true;
    window.__log = {};
    zb.bus.on('bossSpawn', () => { const L = window.__log; L.bossT = G.time; L.bossSquad = G.squad; L.bossWeapon = G.weapon; L.bossLv = G.weaponLv; L.bossMech = !!G.mech; L.bossProg = true; });
    zb.bus.on('bossDied', () => { window.__log.bossDeadT = G.time; });
    zb.bus.on('gameOver', d => { const L = window.__log; L.reason = d.reason; L.cause = d.cause; L.kind = d.kind; L.overT = G.time; L.overPhase = d.phase; });
    zb.bus.on('win', () => { window.__log.won = true; });
    zb.bus.on('heroActivated', () => { window.__log.hero = true; });
    // --hold: a forced gun stays no matter which pickup the squad walks over (other guns are ignored, the same gun still levels up)
    window.__hold = null;
    zb.bus.on('weaponPickup', d => {
      const h = window.__hold;
      if (!h) return;
      if (d.w !== h.w) { G.weapon = h.w; G.weaponLv = h.lv; } else h.lv = G.weaponLv;
    });
    zb.bus.on('weaponPickup', d => { const L = window.__log; L.pickups = (L.pickups || 0) + 1; L.tier = Math.max(L.tier || 0, d.w); });
    zb.bus.on('gatePass', d => { const L = window.__log; L.gates = (L.gates || 0) + 1; if (d.diff < 0) L.badGates = (L.badGates || 0) + 1; (L.gateDiffs = L.gateDiffs || []).push(d.diff); });
  }
  const LOG = window.__log;
  for (const k of Object.keys(LOG)) delete LOG[k];

  // ---- a "decent human": slower reactions, a personal feel for how good each gate is, jittery hands, occasional lapses
  const clampN = (v, a, b) => Math.max(a, Math.min(b, v));
  const gauss = () => { let u = 0; for (let i = 0; i < 6; i++) u += Math.random(); return (u - 3) / 0.7071; };
  const NZ = cfg.noise;
  const persona = {
    dodge: cfg.dodge * clampN(1 + 0.35 * NZ * gauss(), 0.3, 1.9),
    react: 0.12 + 0.12 * NZ * Math.abs(gauss()),          // seconds between decisions
    jitter: 0.28 * NZ,                                      // sd of the aiming error in x
    lapse: 0.04 * NZ,                                       // chance per decision of zoning out for half a second
  };
  const opinions = new Map();
  // how much this particular attempt cares about an event: a personal exaggeration, plus now and then a plain mistake
  // (misreads a gate, never notices the battery, does not bother with a weapon)
  const opinion = e => {
    let o = opinions.get(e);
    if (o === undefined) {
      o = clampN(1 + 0.3 * NZ * gauss(), 0.35, 1.8);
      const r = Math.random();
      if (e.type === 'gate' && r < 0.07 * NZ) o = -0.6;
      else if (e.type === 'hero' && r < 0.15 * NZ) o = 0.05;
      else if (e.type === 'weapon' && r < 0.08 * NZ) o = 0.1;
      opinions.set(e, o);
    }
    return o;
  };

  const popLayer = document.getElementById('pops');
  zb.prepare(cfg.stage);
  zb.start();
  window.__hold = null;
  if (cfg.hold !== undefined && cfg.hold !== null) { G.weapon = cfg.hold; G.weaponLv = 1; window.__hold = { w: cfg.hold, lv: 1 }; }
  const weaponsRoute = cfg.opening === 'weapons';

  const half = () => (zb.formationHalf ? zb.formationHalf() : 0);
  const dtStep = 1 / 60;
  const maxSteps = Math.round(cfg.maxSeconds * 60);
  const GRID = 0.2;
  const BINS = 40;                      // 0.2-wide lanes across the 8-wide deck
  const dang = new Float32Array(BINS);
  let tx = 0, nextDecide = 0;
  const trace = [];

  // opening group: the single (unpaired) gate, the hero and the first two weapons of the level
  const opening = new Set();
  for (const e of G.events) {
    if (e.z < -60) break;
    if (e.type === 'hero' || e.type === 'weapon' || (e.type === 'gate' && e.pair === undefined)) opening.add(e);
  }
  const mode = cfg.opening;

  const lvm = (w, lv) => Math.pow(WP[w].lvMul, lv - 1);
  // shots that land on a gate / battery per second (they stop at both, so pierce does not matter)
  function hitsPerSec() {
    const W = WP[G.weapon];
    return Math.min(G.squad, 40) * W.rate * W.pellets * W.dmg * lvm(G.weapon, G.weaponLv) * (G.squad > 40 ? G.squad / 40 : 1);
  }

  // ---- guns. The roster is balanced so that no gun is simply better; what a player learns is which gun suits which horde.
  // NICHE[gun][kind] = how well that gun handles that kind of horde relative to its own average (from `arena.mjs --cap 1`).
  const KINDS = ['wall', 'blob', 'line', 'swarm', 'runners', 'brutes'];

  const NICHE = [
    [0.95, 0.91, 0.82, 1.11, 1.11, 1.14],   // pistol
    [1.05, 1.00, 0.91, 0.95, 0.96, 1.14],   // rifle
    [1.00, 0.92, 0.80, 1.09, 1.10, 1.13],   // shotgun
    [0.98, 0.90, 0.82, 1.19, 1.13, 1.03],   // gatling
    [1.19, 1.16, 1.11, 0.71, 0.72, 1.29],   // sniper
    [1.26, 1.11, 0.96, 0.95, 0.95, 0.83],   // flamer
    [0.86, 1.03, 1.60, 1.10, 1.11, 0.70],   // rocket
  ];
  const BOSS_NICHE = [1, 1, 0.95, 1.2, 1, 0.9, 0.9];
  let ctx = { w: [0, 0, 0, 0, 0, 0], boss: 0 };
  function readAhead() {
    const w = [0, 0, 0, 0, 0, 0];
    for (const e of G.events) {
      if (e.type !== 'horde') continue;
      const dz = G.z - e.z;
      if (dz < -10 || dz > 80) continue;
      const k = KINDS.indexOf(e.spec.kind === 'open' ? 'blob' : e.spec.kind);
      if (k >= 0) w[k] += Math.sqrt(e.spec.count * e.spec.hp);     // damped: ten big hordes are not ten times one
    }
    ctx = { w, boss: G.L + G.z < 90 ? 1 : 0 };
  }
  function gunScore(w, lv) {
    let num = 0, den = 0;
    for (let k = 0; k < 6; k++) { num += ctx.w[k] * NICHE[w][k]; den += ctx.w[k]; }
    const tot = den + ctx.boss * 8;
    num += ctx.boss * 8 * BOSS_NICHE[w];
    return lvm(w, lv) * (tot > 0 ? num / tot : 1);
  }
  // value (in the same units as gate values) of walking over weapon pickup e
  function gunValue(e) {
    const w = e.w;
    const crate = 1.2 * (zb.TUNE.crateRecruits || 0);                   // every crate brings recruits
    // forced to keep one gun: by default never walk over another gun's crate; with --hold-take the squad still collects the recruits (the harness hands the held gun back)
    if (cfg.hold !== undefined && cfg.hold !== null && w !== cfg.hold) return cfg.holdTake ? crate : -60;
    const cur = gunScore(G.weapon, G.weaponLv);
    if (w === G.weapon) {
      if (G.weaponLv >= WP[w].maxLv) return crate;                     // spare crate: just the recruits
      return crate + Math.max(0.5, Math.min(14, (gunScore(w, G.weaponLv + 1) / cur - 1) * 14));
    }
    // swapping throws away the levels you have: only worth it for a clearly better gun (a human does not trade for a 10 % edge)
    return Math.min(14, crate + Math.max(-3.5, (gunScore(w, 1) / cur - 1.25) * 14));
  }

  function decide() {
    const h = half();
    const lim = Math.max(0, ROAD - 0.45 - h);
    // zombie lane danger histogram
    dang.fill(0);
    if (persona.dodge > 0) {
      for (let i = 0; i < Z.length; i++) {
        const q = Z[i];
        if (q.dying > 0) continue;
        const d = G.z - q.z;
        if (d < -0.5 || d > 18) continue;
        const w = (q.big ? 2.5 : 1) / (0.5 + Math.max(0, d) / 4);
        let b = Math.floor((q.x + ROAD) / (ROAD * 2) * BINS);
        if (b < 0) b = 0; else if (b >= BINS) b = BINS - 1;
        dang[b] += w;
      }
    }
    const reach = Math.round((h + 0.5) / GRID);
    // collect upcoming events
    const gates = [], others = [];
    for (const e of G.events) {
      const dz = G.z - e.z;
      if (dz < -1 || dz > 42) continue;
      if (e.type === 'gate' && !e.used) gates.push(e);
      else if (e.type === 'weapon' && !e.taken) others.push(e);
      else if (e.type === 'hero' && !e.done && !e.missed) others.push(e);
    }
    const hps = hitsPerSec();
    readAhead();
    const gv = new Map();
    for (const e of others) if (e.type === 'weapon') gv.set(e, gunValue(e));
    let bestX = tx, bestC = Infinity;
    for (let x = -lim; x <= lim + 1e-6; x += GRID) {
      let c = 0;
      // gates: the side the squad centre is on decides
      for (const e of gates) {
        const dz = G.z - e.z;
        const wt = dz < 24 ? 1 : Math.max(0, (42 - dz) / 18);
        const side = x >= 0 ? 1 : -1;
        if (side !== e.side) continue;                 // the other gate of the pair (or nothing) is what we pass
        let v = e.val;
        if (e.kind === 'mul') v = Math.max(0, G.squad * (e.val - 1));
        else {
          const inLane = Math.max(0, 1 - Math.abs(x - e.x) / (1.85 + h));
          const noShoot = (mode !== 'auto' && opening.has(e) && mode !== 'gate') || weaponsRoute;
          const t = Math.min(5, Math.max(0, (dz - 1)) / RUN);
          const perEff = (e.per + (zb.TUNE ? zb.TUNE.gatePerSquad : 0) * Math.min(G.squad, 40)) * (e.pf || 1);
          const extra = noShoot ? 0 : hps * t * 0.55 * inLane / perEff;
          v = e.val + Math.floor((e.hits / perEff) + extra);
        }
        if (opening.has(e) && v > 0 && mode !== 'auto' && mode !== 'gate') v = 0;   // not our plan
        if (weaponsRoute && v > 0) v *= 0.7;             // guns-only player: takes the blue side as it is, never shoots a gate up or waits for one
        c -= wt * v * 1.2 * opinion(e);
      }
      for (const e of others) {
        const dz = G.z - e.z;
        const wt = dz < 22 ? 1 : Math.max(0, (40 - dz) / 18);
        let skip = mode !== 'auto' && opening.has(e);
        if (e.type === 'weapon') {
          if (skip && (mode === 'gate' || mode === 'battery')) continue;
          const rad = e.mate ? 0.9 + h * 0.5 : 1.4 + h;
          const val = gv.get(e);
          if (Math.abs(x - e.x) < rad - 0.15) c -= wt * val * (val > 0 ? opinion(e) : 1);
        } else {
          if (weaponsRoute) continue;
          if (skip && mode !== 'battery') continue;
          // battery: expected charge while the squad stays in front of it
          const bz = e.bz;
          const t = Math.min(5, Math.max(0, G.z - bz - 1) / RUN);
          const lo = x - h - 0.2, hi = x + h + 0.2;
          const overlap = Math.max(0, Math.min(hi, e.x + 0.95) - Math.max(lo, e.x - 0.95)) / Math.max(0.5, hi - lo);
          const exp = e.charge + hps * t * 0.5 * overlap;
          const p = Math.min(1, exp / e.need);
          c -= wt * 16 * p * p * opinion(e);
        }
      }
      // zombies
      if (persona.dodge > 0) {
        const b0 = Math.round((x + ROAD) / GRID);
        let dsum = 0;
        for (let b = b0 - reach; b <= b0 + reach; b++) if (b >= 0 && b < BINS) dsum += dang[b];
        c += dsum * 0.09 * persona.dodge;
      }
      c += Math.abs(x - tx) * 0.04;                    // hysteresis: do not twitch
      if (c < bestC - 1e-9) { bestC = c; bestX = x; }
    }
    return bestX;
  }

  let steps = 0;
  while (steps < maxSteps && G.phase !== 'over' && G.phase !== 'win') {
    if (steps >= nextDecide) {
      if (Math.random() < persona.lapse) nextDecide = steps + 30;                      // zoned out: keeps the old target
      else {
        tx = clampN(decide() + persona.jitter * gauss(), -3.55, 3.55);
        nextDecide = steps + Math.max(1, Math.round(persona.react * 60 * (0.7 + 0.6 * Math.random())));
      }
    }
    // finite drag speed (like keyboard play): 9 units/s
    const want = tx, cur = G.tx, mx = 9 * dtStep;
    G.tx = cur + Math.max(-mx, Math.min(mx, want - cur));
    zb.step(dtStep);
    steps++;
    if (cfg.trace && steps % 60 === 0) trace.push(`${(steps / 60) | 0}s z=${G.z.toFixed(0)} sq=${G.squad} w=${G.weapon} x=${G.x.toFixed(1)} Z=${Z.length}${G.mech ? ' mech' : ''}${G.shield > 0 ? ' shld' : ''}`);
    if ((steps & 127) === 0) { popLayer.textContent = ''; zb.pops.length = 0; }
  }

  const timeout = G.phase !== 'over' && G.phase !== 'win';
  const won = G.phase === 'win';
  const prog = won ? 1 : Math.max(0, Math.min(1, -G.z / G.L));
  let cause = 'win';
  if (!won) cause = timeout ? 'timeout' : (LOG.cause || (LOG.reason && LOG.reason.indexOf('數字門') >= 0 ? 'gate' : (G.boss ? 'boss' : 'horde')));
  if (!won && !timeout && LOG.kind) cause += '/' + LOG.kind;
  const res = {
    won, prog, cause, time: G.time, squad: G.squad, kills: G.kills,
    reachedBoss: !!LOG.bossProg, bossSquad: LOG.bossSquad, bossWeapon: LOG.bossWeapon, bossLv: LOG.bossLv, bossMech: LOG.bossMech,
    bossSecs: LOG.bossT === undefined ? null : (LOG.bossDeadT !== undefined ? LOG.bossDeadT - LOG.bossT : (LOG.overT !== undefined ? LOG.overT - LOG.bossT : null)),
    bossKilled: LOG.bossDeadT !== undefined,
    bossHpLeft: G.boss ? Math.max(0, G.boss.hp / G.boss.max) : null,
    gateDiffs: LOG.gateDiffs || [], deathZ: G.z, trace: cfg.trace ? trace : undefined, hero: !!LOG.hero, heroCharge: (() => { const h = G.events.find(e => e.type === 'hero'); return h ? Math.round(h.charge) + '/' + h.need : null; })(), tier: LOG.tier || 0, badGates: LOG.badGates || 0,
  };
  return res;
}

// ------------------------------------------------------------------ driver
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];

async function newPage() {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  // never let the real-time loop run: the harness is the only thing that advances the simulation
  await page.addInitScript(() => { window.requestAnimationFrame = () => 0; });
  await page.route('**/three.min.js', r => r.fulfill({ body: fs.readFileSync(opt.three), contentType: 'application/javascript' }));
  await page.route('https://fonts.**', r => r.abort());
  await page.goto('file://' + opt.html);
  await page.waitForFunction(() => window.__zb);
  await page.evaluate(() => document.getElementById('mute').click());   // SFX off: no WebAudio nodes while fast-forwarding
  await page.evaluate(tune => {
    for (const [k, v] of Object.entries(tune)) {
      const parts = k.split('.'); let o = parts[0] === 'WEAPONS' ? window.__zb : window.__zb.TUNE;   // e.g. WEAPONS.1.rate
      for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]];
      if (!(parts[parts.length - 1] in o)) throw new Error('unknown TUNE key ' + k);
      o[parts[parts.length - 1]] = v;
    }
  }, opt.tune);
  return page;
}

const pages = [];
for (let i = 0; i < opt.workers; i++) pages.push(await newPage());

async function runJobs(jobs) {
  const out = new Array(jobs.length);
  let next = 0;
  await Promise.all(pages.map(async page => {
    while (true) {
      const j = next++;
      if (j >= jobs.length) return;
      out[j] = await page.evaluate(botRun, jobs[j]);
    }
  }));
  return out;
}

const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN;
const pct = (x, n) => n ? (100 * x / n).toFixed(0) + '%' : '-';
const f1 = v => Number.isFinite(v) ? v.toFixed(1) : '-';

const GUNS = ['pistol', 'rifle', 'shotgun', 'gatling', 'sniper', 'flamer', 'rocket'];
const gunIndex = v => { const i = GUNS.indexOf(v); return i >= 0 ? i : Number(v); };
// one row per strategy: { label, opening, hold }
const openings = [];
if (opt.hold !== null) {
  for (const g of (opt.hold === 'all' ? GUNS : opt.hold.split(','))) openings.push({ label: 'hold-' + GUNS[gunIndex(g)], opening: opt.opening === 'all' ? 'auto' : opt.opening, hold: gunIndex(g) });
} else {
  const names = opt.opening === 'all' ? ['auto', 'rifle', 'gate', 'battery'] : opt.opening === 'allw' ? ['auto', 'rifle', 'gate', 'battery', 'weapons'] : [opt.opening];
  for (const o of names) openings.push({ label: o, opening: o, hold: null });
}
const rows = [];
const t0 = Date.now();
for (const stage of opt.stages) {
  for (const row of openings) {
    const opening = row.label;
    const jobs = [];
    for (let i = 0; i < opt.n; i++) jobs.push({ noise: opt.noise, trace: opt.trace && i < 3, stage, opening: row.opening, hold: row.hold, holdTake: opt.holdTake, seed: opt.seed * 100003 + stage * 1009 + i * 7919 + 1, maxSeconds: opt.maxSeconds, dodge: opt.dodge });
    const res = await runJobs(jobs);
    if (opt.trace) for (const r of res) if (r.trace) { console.log(`--- stage ${stage} ${opening} won=${r.won} cause=${r.cause} gates=${r.gateDiffs.join(',')}`); console.log(r.trace.join('\n')); }
    if (opt.dump) fs.appendFileSync(opt.dump, res.map((r, i) => JSON.stringify({ stage, opening, seed: jobs[i].seed, ...r })).join('\n') + '\n');
    const wins = res.filter(r => r.won);
    const atBoss = res.filter(r => r.reachedBoss);
    const fights = atBoss.filter(r => r.bossSecs !== null);
    const winFights = wins.filter(r => r.bossSecs !== null);
    const causes = {};
    for (const r of res) if (!r.won) causes[r.cause] = (causes[r.cause] || 0) + 1;
    rows.push({
      stage, opening, n: res.length, win: wins.length / res.length,
      prog: mean(res.map(r => r.prog)) * 100,
      squadBoss: mean(atBoss.map(r => r.bossSquad)),
      weaponBoss: (() => { const h = {}; for (const r of atBoss) { const k = GUNS[r.bossWeapon] + r.bossLv; h[k] = (h[k] || 0) + 1; } return Object.entries(h).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k, v]) => k + ' ' + pct(v, atBoss.length)).join(' '); })(),
      mechBoss: atBoss.length ? atBoss.filter(r => r.bossMech).length / atBoss.length : NaN,
      reached: atBoss.length / res.length,
      bossSecsWin: mean(winFights.map(r => r.bossSecs)),
      bossSecsAll: mean(fights.map(r => r.bossSecs)),
      causes,
    });
    if (opt.json) fs.writeFileSync(opt.json, JSON.stringify({ opt, rows, errors }, null, 1));
  }
}

// ------------------------------------------------------------------ report
if (opt.line) {
  console.log(rows.map(r => `S${r.stage}${r.opening === 'auto' ? '' : '/' + r.opening} ${(r.win * 100).toFixed(0)}% sq${r.squadBoss.toFixed(0)} boss${r.bossSecsWin.toFixed(0)}s`).join(' | ') + (errors.length ? '  ERRORS ' + errors.length : ''));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
}
const hdr = ['stage', 'open', 'n', 'win', 'prog%', 'atBoss', 'squad@boss', 'wpn@boss', 'mech@boss', 'boss s (win)', 'boss s (all)', 'cause of death'];
const lines = rows.map(r => [
  r.stage, r.opening, r.n, pct(r.win * r.n, r.n), f1(r.prog), pct(r.reached * r.n, r.n), f1(r.squadBoss), r.weaponBoss || '-',
  Number.isFinite(r.mechBoss) ? pct(r.mechBoss * 10, 10) : '-', f1(r.bossSecsWin), f1(r.bossSecsAll),
  Object.entries(r.causes).map(([k, v]) => k + ' ' + pct(v, r.n)).join(', ') || '-',
]);
const widths = hdr.map((h, i) => Math.max(h.length, ...lines.map(l => String(l[i]).length)));
const fmt = l => l.map((c, i) => String(c).padEnd(widths[i])).join('  ');
console.log(fmt(hdr));
console.log(widths.map(w => '-'.repeat(w)).join('  '));
for (const l of lines) console.log(fmt(l));
if (!opt.quiet) console.log(`\n${rows.reduce((a, r) => a + r.n, 0)} attempts in ${((Date.now() - t0) / 1000).toFixed(1)} s wall; page errors: ${errors.length}`);
if (errors.length) console.log(errors.slice(0, 10).join('\n'));
await browser.close();
process.exit(errors.length ? 1 : 0);
