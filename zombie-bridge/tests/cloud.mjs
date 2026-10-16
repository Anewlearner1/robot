// Cloud-save tests for 屍潮斷橋: a fake window.claude (in-memory db with get / set / update / onSnapshot, and a user) is installed before the
// page boots, so the real boot path runs. Exit code 1 if any check fails or the page logs an error.
//   node zombie-bridge/tests/cloud.mjs
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_THREE = '/tmp/claude-0/-home-user-robot/e63d82bf-e5cf-557e-842c-86e09e28f838/scratchpad/vendor/three.min.js';
const three = process.env.THREE_JS || DEFAULT_THREE;
const html = process.env.ZB_HTML || path.resolve(here, '../index.html');
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
const results = [];
const check = (name, ok, detail) => results.push({ name, ok: !!ok, detail: detail === undefined ? '' : String(detail) });

// The fake claude.ai viewer. cfg: { uid, cloudDoc, failSet, failGet, noUser, noDb, local } - all optional.
function fakeViewer(cfg) {
  const F = window.__fake = { cfg, doc: cfg.cloudDoc ? JSON.parse(JSON.stringify(cfg.cloudDoc)) : null, sets: [], gets: 0, subs: [], uses: [] };
  const snap = (pending) => ({ id: 'save', exists: F.doc !== null, data: () => F.doc === null ? undefined : JSON.parse(JSON.stringify(F.doc)), metadata: { fromCache: false, hasPendingWrites: !!pending } });
  const notify = pending => { for (const f of F.subs) setTimeout(() => f(snap(pending)), 0); };
  F.remoteWrite = body => { F.doc = JSON.parse(JSON.stringify(body)); notify(false); };       // another device wrote
  const ref = path => ({
    path, id: 'save',
    get: async () => { F.gets++; if (F.cfg.failGet) throw { code: F.cfg.failGet, message: 'x' }; return snap(false); },
    set: async data => {
      F.sets.push({ at: Date.now(), body: JSON.parse(JSON.stringify(data)) });
      if (F.cfg.failSet) throw { code: F.cfg.failSet, message: 'x' };
      await new Promise(r => setTimeout(r, 20));
      F.doc = JSON.parse(JSON.stringify(data)); notify(true); setTimeout(() => notify(false), 10);
    },
    onSnapshot: next => { F.subs.push(next); setTimeout(() => next(snap(false)), 0); return () => { F.subs = F.subs.filter(f => f !== next); }; },
  });
  F.path = null;
  const db = { doc: p => { F.path = p; return ref(p); }, collection: () => { throw new Error('unused'); } };
  const user = { id: async () => F.cfg.uid === undefined ? 'u_abc' : F.cfg.uid, isOwner: async () => false, canEdit: async () => false, can: async () => null, me: async () => ({}) };
  window.claude = { use: async name => { F.uses.push(name); await new Promise(r => setTimeout(r, 600)); return name === 'db' ? (F.cfg.noDb ? null : db) : name === 'user' ? (F.cfg.noUser ? null : user) : null; } };
}

async function open(cfg, local) {
  const page = await browser.newPage({ viewport: { width: 200, height: 200 } });
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.addInitScript(() => { window.requestAnimationFrame = () => 0; });
  if (cfg !== null) await page.addInitScript(`(${fakeViewer.toString()})(${JSON.stringify(cfg)})`);
  if (local) await page.addInitScript(`try { localStorage.setItem('zombie-bridge-save', ${JSON.stringify(JSON.stringify(local))}); } catch (e) {}`);
  await page.route('**/three.min.js', r => r.fulfill({ body: fs.readFileSync(three), contentType: 'application/javascript' }));
  await page.route('https://fonts.**', r => r.abort());
  await page.goto('file://' + html);
  await page.waitForFunction(() => window.__zb);
  await page.evaluate(() => {
    window.__events = []; window.__zb.bus.on('cloudSync', d => window.__events.push(Object.assign({ t: Date.now() }, d)));
  });
  return page;
}
const ID = { 1: 'n1', 2: 'n2', 3: 'n3a', 4: 'n4a', 5: 'n5', 8: 'p8' };       // stage number -> main-path node id
// A save document for the fixtures; `stages: { n: {entry, stars} }` is shorthand for the v2 nodes of the main path.
const S = (o = {}) => {
  const x = Object.assign({ v: 2, coins: 0, best: 1, upgrades: {}, nodes: {}, cur: 'n1', rev: 0, updatedAt: 0, epoch: 0 }, o);
  if (x.stages) { x.nodes = {}; for (const k of Object.keys(x.stages)) x.nodes[ID[k]] = { entry: x.stages[k].entry, stars: x.stages[k].stars, cleared: x.stages[k].stars > 0 }; delete x.stages; }
  return x;
};
const ev = (page, js) => page.evaluate(js);
const settle = page => page.evaluate(async () => { await window.__zb.cloud.flush(); return window.__zb.cloud.state(); });

// ---- 1. boot with no cloud doc: the local save is written up
{
  const page = await open({}, S({ best: 3, coins: 120, rev: 4, updatedAt: 1000, upgrades: { dmg: 2 }, stages: { 2: { entry: 30, stars: 2 }, 3: { entry: 41, stars: 1 } } }));
  const state = await settle(page);
  const f = await page.evaluate(() => ({ doc: window.__fake.doc, sets: window.__fake.sets.length, path: window.__fake.path, uses: window.__fake.uses, G: window.__zb.G.cloud, subs: window.__fake.subs.length }));
  check('boot, no cloud doc: the local save is written up once, to data/users/<id>/save', state === 'synced' && f.sets === 1 && f.path === 'data/users/u_abc/save' && f.doc && f.doc.best >= 3 && f.doc.coins === 120 && f.doc.upgrades.dmg === 2 && f.doc.nodes[ID[3]].entry === 41, JSON.stringify(f));
  check('boot: db and user were requested, one onSnapshot subscription, G.cloud.user is true', f.uses.includes('db') && f.uses.includes('user') && f.subs === 1 && f.G.user === true && f.G.lastSyncAt > 0);
  const evs = await page.evaluate(() => window.__events.map(e => e.state));
  check('boot: cloudSync events go syncing -> synced', evs.join() === 'syncing,synced', evs.join());
  await page.close();
}
// ---- 1b. a fresh install with no cloud doc writes nothing
{
  const page = await open({}, null);
  const state = await settle(page);
  const n = await page.evaluate(() => window.__fake.sets.length);
  const dd = await page.evaluate(() => JSON.stringify(window.__fake.sets[0] && window.__fake.sets[0].body));
  check('boot, nothing to save anywhere: no write, state synced', n === 0 && state === 'synced', `${n} ${state} ${dd}`);
  await page.close();
}
// ---- 2. boot with a newer cloud doc: merge
{
  const local = S({ best: 2, coins: 500, rev: 3, updatedAt: 1000, upgrades: { dmg: 1 }, stages: { 2: { entry: 30, stars: 2 } } });
  const cloud = S({ best: 4, coins: 100, rev: 5, updatedAt: 5000, upgrades: { dmg: 0, rate: 2 }, stages: { 2: { entry: 20, stars: 3 }, 3: { entry: 40, stars: 1 } } });
  const page = await open({ cloudDoc: cloud }, local);
  const state = await settle(page);
  const r = await page.evaluate(() => ({ save: JSON.parse(JSON.stringify(window.__zb.SAVE)), doc: window.__fake.doc, sets: window.__fake.sets.length, ls: JSON.parse(localStorage.getItem('zombie-bridge-save')), ev: window.__events.filter(e => e.merged).length, best: window.__zb.G.level }));
  const s = r.save;
  check('merge: best max, stars max, entry max, upgrades per-id max', s.best === 4 && s.nodes[ID[2]].stars === 3 && s.nodes[ID[2]].entry === 30 && s.nodes[ID[3]].entry === 40 && s.upgrades.dmg === 1 && s.upgrades.rate === 2, JSON.stringify(s));
  check('merge: coins come from the copy with the newer updatedAt (the cloud: 100, not max 500)', s.coins === 100, s.coins);
  check('merge: localStorage got the merged save, a merged cloudSync event fired', r.ls.best === 4 && r.ls.upgrades.rate === 2 && r.ev === 1, JSON.stringify([r.ls.best, r.ev]));
  check('merge: the cloud gets the merge back (it lacked entry 30 and dmg 1), rev moved past both', r.sets === 1 && r.doc.nodes[ID[2]].entry === 30 && r.doc.upgrades.dmg === 1 && r.doc.rev > 5 && state === 'synced', JSON.stringify([r.sets, r.doc.rev]));
  await page.close();
}
{
  const local = S({ best: 2, coins: 500, rev: 3, updatedAt: 9000, stages: { 2: { entry: 30, stars: 2 } } });
  const cloud = S({ best: 2, coins: 100, rev: 2, updatedAt: 5000, stages: { 2: { entry: 30, stars: 2 } } });
  const page = await open({ cloudDoc: cloud }, local);
  await settle(page);
  const r = await page.evaluate(() => ({ coins: window.__zb.SAVE.coins, doc: window.__fake.doc.coins }));
  check('merge: when local is newer its coins win and go up', r.coins === 500 && r.doc === 500, JSON.stringify(r));
  await page.close();
}
{
  const same = S({ best: 3, coins: 50, rev: 4, updatedAt: 4000, stages: { 2: { entry: 30, stars: 2 } } });
  const page = await open({ cloudDoc: same }, same);
  await settle(page);
  const n = await page.evaluate(() => window.__fake.sets.length);
  check('merge: identical local and cloud -> no write at all', n === 0, n);
  await page.close();
}
// ---- 2b. debounce and unchanged saves
{
  const page = await open({}, S({ best: 2, rev: 1, updatedAt: 10, stages: { 2: { entry: 12, stars: 1 } } }));
  await settle(page);
  await page.evaluate(() => { const z = window.__zb; for (let i = 0; i < 5; i++) { z.SAVE.coins += 10; z.saveGame(); } });
  await page.waitForTimeout(700);
  const mid = await page.evaluate(() => window.__fake.sets.length);
  await page.waitForTimeout(1600);
  const after = await page.evaluate(() => ({ sets: window.__fake.sets.length, coins: window.__fake.doc.coins }));
  check('writes: a burst of 5 saves is one write, about 1.5 s after the last (none before)', mid === 1 && after.sets === 2 && after.coins === 50, JSON.stringify({ mid, after }));
  await page.evaluate(() => { window.__zb.saveGame(); window.__zb.saveGame(); });
  await page.waitForTimeout(2000);
  const same = await page.evaluate(() => window.__fake.sets.length);
  check('writes: saveGame with unchanged content (only rev / updatedAt move) writes nothing', same === 2, same);
  await page.evaluate(() => { window.__zb.SAVE.coins += 1; window.__zb.saveGame(); window.__zb.cloud.flush(); });
  await page.waitForTimeout(300);
  const flushed = await page.evaluate(() => window.__fake.sets.length);
  check('writes: flush() writes the pending change immediately (no 1.5 s wait)', flushed === 3, flushed);
  // pagehide / hidden flush
  await page.evaluate(() => { window.__zb.SAVE.coins += 1; window.__zb.saveGame(); window.dispatchEvent(new Event('pagehide')); });
  await page.waitForTimeout(300);
  const ph = await page.evaluate(() => window.__fake.sets.length);
  check('writes: pagehide flushes right away', ph === 4, ph);
  await page.close();
}
// ---- 2b. round 7: two devices played different branches - the node union keeps both, cleared is OR, stars / entry max, cur from the newer copy
{
  const nd = (entry, stars, cleared) => ({ entry, stars, cleared });
  const local = S({ best: 4, coins: 10, rev: 3, updatedAt: 1000, cur: 'n4a', nodes: { n1: nd(1, 3, true), n2: nd(40, 2, true), n3a: nd(60, 2, true), n4a: nd(70, 0, false) } });
  const cloud = S({ best: 4, coins: 20, rev: 5, updatedAt: 5000, cur: 'n4b', nodes: { n1: nd(1, 3, true), n2: nd(45, 3, true), n3a: nd(66, 1, false), n3b: nd(55, 3, true), n4b: nd(80, 0, false) } });
  const page = await open({ cloudDoc: cloud }, local);
  await settle(page);
  const r = await page.evaluate(() => { const zb = window.__zb; return { save: JSON.parse(JSON.stringify(zb.SAVE)), st: ['n3a', 'n3b', 'n4a', 'n4b', 'n5'].map(id => zb.nodeState(id)), doc: window.__fake.doc }; });
  const n = r.save.nodes;
  check('merge (branches): both branches survive - n3a and n3b present, n4a and n4b present', ['n3a', 'n3b', 'n4a', 'n4b'].every(k => n[k]), Object.keys(n).join());
  check('merge (branches): cleared is OR (n3a cleared on one device only), stars max, entry max', n.n3a.cleared === true && n.n3a.stars === 2 && n.n3a.entry === 66 && n.n2.stars === 3 && n.n2.entry === 45 && n.n3b.cleared && n.n3b.stars === 3, JSON.stringify(n));
  check('merge (branches): cur comes from the newer copy; both depth-4 nodes are open after the merge, n5 still locked', r.save.cur === 'n4b' && r.st.join() === 'cleared,cleared,open,open,locked', r.save.cur + ' ' + r.st.join());
  check('merge (branches): the merged document went back to the cloud with both branches', r.doc && r.doc.nodes.n3a && r.doc.nodes.n3b && r.doc.nodes.n3a.cleared && r.doc.nodes.n3b.cleared);
  await page.close();
}

// ---- 3. view-only: set rejects invalid_argument
{
  const page = await open({ failSet: 'invalid_argument' }, S({ best: 3, rev: 2, updatedAt: 5, stages: { 2: { entry: 20, stars: 1 } } }));
  const state = await settle(page);
  await page.evaluate(async () => { const z = window.__zb; for (let i = 0; i < 4; i++) { z.SAVE.coins += 5; z.saveGame(); } await z.cloud.flush(); });
  await page.waitForTimeout(1800);
  const r = await page.evaluate(() => ({ sets: window.__fake.sets.length, st: window.__zb.cloud.state(), subs: window.__fake.subs.length, ls: JSON.parse(localStorage.getItem('zombie-bridge-save')).coins }));
  check("view-only (set rejects invalid_argument): state 'local', exactly one write attempt, no retry storm, local saves keep working", state === 'local' && r.st === 'local' && r.sets === 1 && r.ls === 20 && r.subs === 0, JSON.stringify(r));
  await page.close();
}
// ---- 4. unavailable: one retry, then pending
{
  const page = await open({ failSet: 'unavailable' }, S({ best: 3, rev: 2, updatedAt: 5, stages: { 2: { entry: 20, stars: 1 } } }));
  await page.waitForFunction(() => window.__zb.cloud.state() === 'pending', null, { timeout: 8000, polling: 100 });
  const r = await page.evaluate(() => ({ sets: window.__fake.sets.length, st: window.__zb.cloud.state(), evs: window.__events.map(e => e.state).join() }));
  check("unavailable: one retry after a short delay, then state 'pending'", r.sets === 2 && r.st === 'pending' && r.evs === 'syncing,pending', JSON.stringify(r));
  await page.waitForTimeout(1500);
  const later = await page.evaluate(() => window.__fake.sets.length);
  check('unavailable: no further attempts on its own (the next save retries)', later === 2, later);
  await page.evaluate(() => { window.__fake.cfg.failSet = null; window.__zb.SAVE.coins += 1; window.__zb.saveGame(); });
  await page.waitForTimeout(2200);
  const rec = await page.evaluate(() => ({ st: window.__zb.cloud.state(), doc: window.__fake.doc && window.__fake.doc.coins }));
  check("unavailable: once the store is back the next save syncs ('synced')", rec.st === 'synced' && rec.doc === 1, JSON.stringify(rec));
  await page.close();
}
// ---- 4b. terminal errors and a failing first read
{
  const page = await open({ failSet: 'revoked' }, S({ best: 3, rev: 2, updatedAt: 5 }));
  const state = await settle(page);
  check("revoked: state 'error', local-only for the visit", state === 'error');
  await page.close();
  const p2 = await open({ failGet: 'unavailable' }, S({ best: 3, rev: 2, updatedAt: 5 }));
  const st2 = await settle(p2);
  const r2 = await p2.evaluate(() => ({ sets: window.__fake.sets.length, gets: window.__fake.gets }));
  check("unreadable cloud: it never overwrites what it could not read (no set), one retry of the read, then 'pending'", st2 === 'pending' && r2.sets === 0 && r2.gets === 2, JSON.stringify(r2));
  await p2.close();
}
// ---- 5. a remote snapshot during a run is deferred until the run ends
{
  const page = await open({}, S({ best: 2, rev: 2, updatedAt: 100, coins: 10, stages: { 2: { entry: 20, stars: 1 } } }));
  await settle(page);
  await page.evaluate(() => { window.__zb.startStage(1); });
  await page.evaluate(() => window.__fake.remoteWrite({ v: 1, coins: 77, best: 5, upgrades: { rate: 3 }, stages: { 2: { entry: 25, stars: 3 }, 4: { entry: 50, stars: 2 } }, rev: 9, updatedAt: Date.now() + 5000, epoch: 0 }));
  await page.waitForTimeout(200);
  const during = await page.evaluate(() => ({ best: window.__zb.SAVE.best, phase: window.__zb.G.phase }));
  check('remote snapshot during a run: nothing is applied while the player is in the run', during.phase === 'run' && during.best === 3, JSON.stringify(during));
  await page.evaluate(() => { window.__zb.G.phase = 'over'; });
  await page.evaluate(() => window.__zb.cloud.flush());
  const after = await page.evaluate(() => ({ s: JSON.parse(JSON.stringify(window.__zb.SAVE)), merged: window.__events.filter(e => e.merged).length }));
  check('remote snapshot: applied (merged) as soon as the run is over', after.s.best === 5 && after.s.upgrades.rate === 3 && after.s.nodes[ID[4]].entry === 50 && after.s.coins === 77 && after.merged >= 1, JSON.stringify(after));
  // in the menu it applies at once
  await page.evaluate(() => { window.__zb.prepare(1); window.__fake.remoteWrite({ v: 1, coins: 78, best: 6, upgrades: {}, stages: {}, rev: 20, updatedAt: Date.now() + 9000, epoch: 0 }); });
  await page.waitForTimeout(200);
  const menu = await page.evaluate(() => window.__zb.SAVE.best);
  check('remote snapshot in the menu: applied at once', menu === 6, menu);
  // our own echo does nothing
  const n0 = await page.evaluate(() => window.__fake.sets.length);
  await page.waitForTimeout(300);
  const n1 = await page.evaluate(() => window.__fake.sets.length);
  check('remote snapshot: no write loop (applying a snapshot does not write back what the cloud has)', n1 - n0 <= 1, `${n0} -> ${n1}`);
  await page.close();
}
// ---- 6. resetSave resets the cloud doc (and wins over an old copy)
{
  const page = await open({}, S({ best: 4, coins: 300, rev: 6, updatedAt: 500, upgrades: { dmg: 2 }, stages: { 2: { entry: 30, stars: 3 }, 3: { entry: 44, stars: 2 } } }));
  await settle(page);
  await page.evaluate(() => { window.__zb.resetSave(); });
  await page.evaluate(() => window.__zb.cloud.flush());
  const r = await page.evaluate(() => ({ doc: window.__fake.doc, sets: window.__fake.sets.length, save: JSON.parse(JSON.stringify(window.__zb.SAVE)), ls: JSON.parse(localStorage.getItem('zombie-bridge-save')) }));
  check('resetSave: the cloud doc is overwritten with a fresh save (kept, not deleted), at a higher epoch', r.doc && r.doc.best === 1 && r.doc.coins === 0 && Object.keys(r.doc.nodes).length === 0 && r.doc.epoch >= 1 && r.sets === 2, JSON.stringify(r.doc));
  check('resetSave: the local cache keeps the epoch so a stale cloud copy cannot revive the old progress', r.ls.epoch === r.doc.epoch && r.save.best === 1);
  const merged = await page.evaluate(() => window.__zb.cloud.merge(window.__zb.SAVE, { v: 1, coins: 999, best: 9, upgrades: { dmg: 5 }, stages: { 8: { entry: 90, stars: 3 } }, rev: 50, updatedAt: 1, epoch: 0 }));
  check('merge: an old-epoch copy (a device that never saw the reset) loses to the reset as a whole', merged.best === 1 && merged.coins === 0 && Object.keys(merged.nodes).length === 0, JSON.stringify(merged));
  await page.close();
  // an old device boots after the reset and picks it up
  const old = await open({ cloudDoc: r.doc }, S({ best: 4, coins: 300, rev: 6, updatedAt: 500, stages: { 2: { entry: 30, stars: 3 } } }));
  await settle(old);
  const o = await old.evaluate(() => ({ best: window.__zb.SAVE.best, st: Object.keys(window.__zb.SAVE.nodes).length, sets: window.__fake.sets.length }));
  check('resetSave: another device with the old save adopts the reset on its next boot (and does not write the old data back)', o.best === 1 && o.st === 0 && o.sets === 0, JSON.stringify(o));
  await old.close();
}
// ---- 7. no window.claude at all: everything works as before
{
  const page = await open(null, S({ best: 3, rev: 1, updatedAt: 1, stages: { 2: { entry: 22, stars: 1 } } }));
  const r = await page.evaluate(async () => {
    const z = window.__zb;
    z.SAVE.coins = 15; z.saveGame();
    await z.cloud.flush();
    z.startStage(1);
    return { st: z.cloud.state(), g: JSON.parse(JSON.stringify(z.G.cloud)), ls: JSON.parse(localStorage.getItem('zombie-bridge-save')).coins, hasClaude: typeof window.claude, best: z.SAVE.best, evs: window.__events.length };
  });
  check("window.claude undefined: state 'off', local saves and gameplay work as before, no events", r.st === 'off' && r.g.user === false && r.ls === 15 && r.hasClaude === 'undefined' && r.best === 3 && r.evs === 0, JSON.stringify(r));
  await page.close();
}
// ---- 8. no db / no user / no identity: off
for (const [label, cfg] of [['db is null', { noDb: true }], ['user is null', { noUser: true }], ['user id is null', { uid: null }]]) {
  const page = await open(cfg, S({ best: 3, rev: 1, updatedAt: 1 }));
  const state = await settle(page);
  const n = await page.evaluate(() => window.__fake.sets.length);
  check(`${label}: state 'off', nothing written`, state === 'off' && n === 0, `${state} ${n}`);
  await page.close();
}

let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok || !r.detail ? '' : '   [' + r.detail + ']'}`);
}
console.log(`\n${results.length - failed}/${results.length} cloud checks passed; page errors: ${errors.length}`);
if (errors.length) console.log(errors.slice(0, 10).join('\n'));
await browser.close();
process.exit(failed || errors.length ? 1 : 0);
