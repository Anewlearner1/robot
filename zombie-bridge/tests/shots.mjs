// Screenshot tool for visual review of 屍潮斷橋: the menu, the world map, the node card, a mid-run shot of each map node,
// the boss fight, the result card and the shop.
// Usage: node zombie-bridge/tests/shots.mjs [--out DIR] [--w 390] [--h 844]
// Launch, three.js and font handling match checks.mjs (THREE_JS / ZB_HTML env overrides). Exit code 1 if the page logs an error
// or a capture step does not reach the state it needs.
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_THREE = '/tmp/claude-0/-home-user-robot/e63d82bf-e5cf-557e-842c-86e09e28f838/scratchpad/vendor/three.min.js';
const three = process.env.THREE_JS || DEFAULT_THREE;
const html = process.env.ZB_HTML || path.resolve(here, '../index.html');

const argv = process.argv.slice(2);
const opt = (name, d) => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d; };
const outDir = path.resolve(opt('--out', path.join(here, 'shots-out')));
const W = parseInt(opt('--w', '390'), 10), H = parseInt(opt('--h', '844'), 10);
if (!(W > 0 && H > 0)) { console.error('bad --w/--h'); process.exit(2); }

const BATCH = 600;             // max __zb.step() calls per page.evaluate (headless rendering is slow; keep each call short)
const SHOT_TIMEOUT = 60000;
// Map nodes shot mid-run. stageN.png (N = 1..5) is the main-path node of depth N, so it is a copy of node-<id>.png.
const NODE_SHOTS = ['n1', 'n2', 'n3a', 'n3b', 'n4a', 'n4b', 'n5'];
const MAIN_PATH = { stage1: 'n1', stage2: 'n2', stage3: 'n3a', stage4: 'n4a', stage5: 'n5' };
const errors = [], files = [];
const problem = msg => { errors.push(msg); console.log('ERROR ' + msg); };

// Steps the simulation in batches until `until` holds: 'mid' (G.z past the middle of the bridge), 'boss' (G.boss exists), 'win'
// (G.phase win), or 'none' (just spend the budget). Shield is held at 999 so the squad survives. Stops early on game over.
async function runUntil(page, until, budget) {
  let used = 0, last = { i: 0, reached: false, phase: '', z: 0, boss: false };
  while (used < budget) {
    last = await page.evaluate(({ until, n }) => {
      const zb = window.__zb, G = zb.G;
      G.shield = 999;
      const reached = () => {
        if (until === 'mid') return G.z < -G.L / 2;
        if (until === 'boss') return !!G.boss;
        if (until === 'win') return G.phase === 'win';
        return false;
      };
      let i = 0;
      while (i < n && !reached() && G.phase !== 'over') { zb.step(1 / 60); i++; }
      return { i, reached: reached(), phase: G.phase, z: +G.z.toFixed(2), boss: !!G.boss };
    }, { until, n: Math.min(BATCH, budget - used) });
    used += last.i;
    if (last.reached || last.phase === 'over' || last.i === 0) break;
  }
  return { ...last, used };
}

// Starts a map node: leaves any run first (startNode refuses a call mid-run), marks the node's parents cleared so it is open,
// then startNode(id). Returns false when the engine refuses the node.
async function startNodeOpen(page, id) {
  return page.evaluate(id => {
    const zb = window.__zb;
    zb.G.phase = 'menu';
    for (const p of zb.MAP.filter(n => n.next.includes(id))) zb.SAVE.nodes[p.id] = Object.assign({ entry: 30, stars: 1 }, zb.SAVE.nodes[p.id], { cleared: true });
    zb.SAVE.nodes[id] = Object.assign({ entry: 30, stars: 0 }, zb.SAVE.nodes[id], { cleared: false });
    return zb.startNode(id) === true;
  }, id);
}

async function snap(page, name) {
  await page.evaluate(() => window.__zb.render(0));
  const file = path.join(outDir, name);
  await page.screenshot({ path: file, timeout: SHOT_TIMEOUT });
  files.push(file);
}

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  fs.mkdirSync(outDir, { recursive: true });
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  page.on('console', m => { if (m.type() === 'error') problem('console: ' + m.text()); });
  page.on('pageerror', e => problem('pageerror: ' + e.message));
  await page.route('**/three.min.js', r => r.fulfill({ body: fs.readFileSync(three), contentType: 'application/javascript' }));
  await page.route('https://fonts.**', r => r.abort());
  await page.goto('file://' + html);
  await page.waitForFunction(() => window.__zb);
  await page.evaluate(() => document.getElementById('mute').click());

  // 1. menu
  await page.waitForTimeout(1000);
  await snap(page, 'menu.png');

  // 2. world map with n1 and n2 cleared, then the node card of n3a
  await page.evaluate(() => {
    const zb = window.__zb;
    zb.resetSave();
    zb.SAVE.nodes = { n1: { entry: 1, stars: 3, cleared: true }, n2: { entry: 40, stars: 2, cleared: true } };
    zb.mapRefresh();
  });
  await page.waitForTimeout(500);
  await snap(page, 'map.png');
  await page.evaluate(() => window.__zb.mapSelect('n3a'));
  await page.waitForTimeout(200);
  await snap(page, 'node-card.png');

  // 3. a mid-run shot of each map node (stage1..5 are the main-path nodes, copied from their node shots)
  for (const id of NODE_SHOTS) {
    if (!(await startNodeOpen(page, id))) { problem(`node ${id}: startNode refused`); continue; }
    const r = await runUntil(page, 'mid', 3000);
    if (!r.reached) problem(`node ${id}: middle not reached (phase ${r.phase}, z ${r.z}, ${r.used} steps)`);
    await snap(page, `node-${id}.png`);
  }
  for (const [stage, id] of Object.entries(MAIN_PATH)) {
    const from = path.join(outDir, `node-${id}.png`), to = path.join(outDir, `${stage}.png`);
    if (fs.existsSync(from)) { fs.copyFileSync(from, to); files.push(to); } else problem(`${stage}: node-${id}.png missing`);
  }

  // 4. boss on n1: every gate used, jump to the bridge end, then ~3 s (180 steps) after the boss appears
  await page.evaluate(() => {
    const zb = window.__zb;
    zb.resetSave();
    zb.G.phase = 'menu';
    zb.SAVE.nodes.n1 = { entry: 30, stars: 0, cleared: false };
    zb.startNode('n1');
    const G = zb.G;
    for (const e of G.events) if (e.type === 'gate') e.used = true;
    G.z = -G.L + 1;
  });
  const b = await runUntil(page, 'boss', 600);
  if (!b.boss) problem(`n1: boss never spawned (phase ${b.phase}, z ${b.z}, ${b.used} steps)`);
  await runUntil(page, 'none', 180);
  await snap(page, 'boss.png');

  // 5. result: keep fighting (shield on) until the win, then let the result card finish its animation (3 s real time)
  const w = await runUntil(page, 'win', 4000);
  if (!w.reached) problem(`n1: no win (phase ${w.phase}, ${w.used} steps)`);
  await page.waitForTimeout(3000);
  await snap(page, 'result.png');

  // 6. shop: the first visible 強化 button (the result card's, after a win)
  await page.locator('button:visible', { hasText: '強化' }).first().click({ timeout: SHOT_TIMEOUT });
  await page.waitForTimeout(1000);
  await snap(page, 'shop.png');
} catch (e) {
  problem('run: ' + String(e && e.message ? e.message : e).split('\n')[0]);
} finally {
  await browser.close();
}

for (const f of files) console.log(f);
console.log(`errors: ${errors.length}`);
process.exit(errors.length > 0 ? 1 : 0);
