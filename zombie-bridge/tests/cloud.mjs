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

// ================================================================ round 8: the firebase provider (fake firebase compat SDK)
// A fake window.firebase (app / auth / firestore) is installed before boot together with the test hook window.__FIREBASE_CONFIG_OVERRIDE.
// fcfg: { user (signed in at boot: {uid, displayName, photoURL}), signInUser (who the popup signs in), cloudDocs: { uid: doc }, popupError, failSet, failGet, parts }
// parts: 'all' (install the whole stub) or 'lazy' (nothing installed: the page must load the three SDK scripts, which the test serves).
function fakeFirebase(fcfg, part) {
  const F = window.__fb = window.__fb || { cfg: fcfg, docs: {}, sets: [], gets: [], subs: {}, listeners: [], calls: [], user: fcfg.user || null, initCfg: null, loaded: [] };
  for (const [uid, d] of Object.entries(fcfg.cloudDocs || {})) if (!(('saves/' + uid) in F.docs)) F.docs['saves/' + uid] = JSON.parse(JSON.stringify(d));
  const snap = (path, pending) => ({ exists: F.docs[path] !== undefined, data: () => F.docs[path] === undefined ? undefined : JSON.parse(JSON.stringify(F.docs[path])), metadata: { hasPendingWrites: !!pending } });
  const notify = (path, pending) => { for (const f of (F.subs[path] || [])) setTimeout(() => f(snap(path, pending)), 0); };
  F.remoteWrite = (uid, body) => { F.docs['saves/' + uid] = JSON.parse(JSON.stringify(body)); notify('saves/' + uid, false); };      // another device wrote
  const docRef = path => ({
    path,
    get: async () => { F.gets.push(path); if (F.cfg.failGet) throw { code: F.cfg.failGet }; return snap(path, false); },
    set: async data => {
      F.sets.push({ path, body: JSON.parse(JSON.stringify(data)) });
      if (F.cfg.failSet) throw { code: F.cfg.failSet };
      await new Promise(r => setTimeout(r, 15));
      F.docs[path] = JSON.parse(JSON.stringify(data)); notify(path, true); setTimeout(() => notify(path, false), 10);
    },
    onSnapshot: (next, err) => { (F.subs[path] = F.subs[path] || []).push(next); setTimeout(() => next(snap(path, false)), 0); return () => { F.subs[path] = F.subs[path].filter(f => f !== next); }; },
  });
  const firestore = { collection: name => ({ doc: id => docRef(name + '/' + id) }) };
  const fire = () => { for (const l of F.listeners) setTimeout(() => l(F.user), 0); };
  const auth = {
    get currentUser() { return F.user; },
    onAuthStateChanged: cb => { F.listeners.push(cb); setTimeout(() => cb(F.user), 5); return () => { F.listeners = F.listeners.filter(l => l !== cb); }; },
    signInWithPopup: async () => { F.calls.push('popup'); if (F.cfg.popupError) throw { code: F.cfg.popupError }; F.user = F.cfg.signInUser; fire(); return { user: F.user }; },
    signInWithRedirect: async () => { F.calls.push('redirect'); F.user = F.cfg.signInUser; fire(); },
    getRedirectResult: async () => null,
    signOut: async () => { F.calls.push('signOut'); F.user = null; fire(); },
  };
  const w = window;
  if (part === 'all' || part === 'app') { w.firebase = w.firebase || { apps: [] }; w.firebase.initializeApp = function (c) { F.initCfg = c; this.apps.push(c); }; F.loaded.push('app'); }
  if (part === 'all' || part === 'auth') { w.firebase.auth = Object.assign(() => auth, { GoogleAuthProvider: function () { this.id = 'google.com'; } }); F.loaded.push('auth'); }
  if (part === 'all' || part === 'store') { w.firebase.firestore = () => firestore; F.loaded.push('store'); }
  w.__FIREBASE_CONFIG_OVERRIDE = { apiKey: 'test', projectId: 'zb-test' };
}
const U1 = { uid: 'uid1', displayName: 'Ada', photoURL: 'https://example.com/a.png' };
async function openFb(fcfg, local, opt = {}) {
  const page = await browser.newPage({ viewport: { width: 200, height: 200 } });
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.addInitScript(() => { window.requestAnimationFrame = () => 0; });
  if (fcfg !== null && !opt.lazy) await page.addInitScript(`(${fakeFirebase.toString()})(${JSON.stringify(fcfg)}, 'all')`);
  if (opt.lazy) {                                                       // the page loads the SDK by script tags: serve fake files, remember the order
    await page.addInitScript(`window.__FIREBASE_CONFIG_OVERRIDE = { apiKey: 'test', projectId: 'zb-test' };`);
    const part = { app: 'app', auth: 'auth', firestore: 'store' };
    for (const f of ['app', 'auth', 'firestore']) await page.route(`https://www.gstatic.com/firebasejs/10.12.2/firebase-${f}-compat.js`, r => r.fulfill({ contentType: 'application/javascript', body: `(${fakeFirebase.toString()})(${JSON.stringify(fcfg)}, '${part[f]}')` }));
  }
  if (local) await page.addInitScript(`try { localStorage.setItem('zombie-bridge-save', ${JSON.stringify(JSON.stringify(local))}); } catch (e) {}`);
  await page.route('**/three.min.js', r => r.fulfill({ body: fs.readFileSync(three), contentType: 'application/javascript' }));
  await page.route('https://fonts.**', r => r.abort());
  await page.goto('file://' + html);
  await page.waitForFunction(() => window.__zb);
  await page.evaluate(() => {
    window.__events = []; window.__auth = [];
    window.__zb.bus.on('cloudSync', d => window.__events.push(Object.assign({ t: Date.now() }, d)));
    window.__zb.bus.on('authState', d => window.__auth.push(d));
  });
  return page;
}
const LOCAL1 = S({ best: 3, coins: 40, rev: 2, updatedAt: 1000, stages: { 2: { entry: 30, stars: 2 }, 3: { entry: 41, stars: 1 } } });
// ---- F1. provider selection
{
  const page = await openFb({}, null);
  const r = await page.evaluate(async () => { await window.__zb.cloud.flush(); return { prov: window.__zb.G.cloud.provider, st: window.__zb.cloud.state(), scripts: document.querySelectorAll('script[src*=gstatic]').length }; });
  check("provider: no window.claude and a config -> 'firebase' (stub SDK used as is, no script tag added)", r.prov === 'firebase' && r.scripts === 0, JSON.stringify(r));
  await page.close();
}
{
  const page = await open({}, null);
  await page.evaluate(() => { window.__FIREBASE_CONFIG_OVERRIDE = { apiKey: 'x' }; window.firebase = { auth: () => { throw new Error('must not be used'); }, firestore: () => { throw new Error('nope'); } }; });
  const r = await page.evaluate(async () => { await window.__zb.cloud._inject(window.claude); return { prov: window.__zb.G.cloud.provider, scripts: document.querySelectorAll('script[src*=gstatic]').length }; });
  check("provider: window.claude present -> 'claude' even with a firebase config; the Firebase SDK is never loaded inside claude.ai", r.prov === 'claude' && r.scripts === 0, JSON.stringify(r));
  await page.close();
}
{
  const page = await open(null, null);
  const r = await page.evaluate(() => ({ prov: window.__zb.G.cloud.provider, st: window.__zb.cloud.state(), acct: window.__zb.G.cloud.account }));
  check("provider: neither window.claude nor a config -> provider null, state 'off'", r.prov === null && r.st === 'off' && r.acct === null, JSON.stringify(r));
  await page.close();
}
// ---- F2. signed out at boot
{
  const page = await openFb({ signInUser: U1 }, LOCAL1);
  const r = await page.evaluate(async () => { await window.__zb.cloud.flush(); const z = window.__zb; window.__auth.length = 0; await z.cloud._inject(null); z.SAVE.coins += 5; z.saveGame(); await z.cloud.flush(); return { st: z.cloud.state(), g: JSON.parse(JSON.stringify(z.G.cloud)), sets: window.__fb.sets.length, auth: window.__auth.slice() }; });
  check("firebase signed out: state 'local', provider firebase, account null, authState { signedIn: false }, local saves work and nothing is written", r.st === 'local' && r.g.provider === 'firebase' && r.g.account === null && r.g.user === false && r.sets === 0 && r.auth.length >= 1 && r.auth[r.auth.length - 1].signedIn === false && r.auth[0].provider === 'firebase', JSON.stringify(r));
  await page.close();
}
// ---- F3. sign in: popup, doc saves/<uid>, local progress goes up
{
  const page = await openFb({ signInUser: U1 }, LOCAL1);
  await settle(page);
  const r = await page.evaluate(async () => { const z = window.__zb; const ok = await z.cloudSignIn(); await z.cloud.flush(); return { ok, st: z.cloud.state(), g: JSON.parse(JSON.stringify(z.G.cloud)), calls: window.__fb.calls.slice(), sets: window.__fb.sets.map(s => s.path), doc: window.__fb.docs['saves/uid1'], auth: window.__auth.slice(), init: window.__fb.initCfg }; });
  check("sign-in: cloudSignIn() uses the Google popup and resolves true; state 'synced', G.cloud.account { name, photo }, authState { provider: 'firebase', signedIn: true, name, photo }", r.ok === true && r.calls.join() === 'popup' && r.st === 'synced' && r.g.account.name === 'Ada' && r.g.account.photo === U1.photoURL && r.g.user === true && r.auth[r.auth.length - 1].signedIn === true && r.auth[r.auth.length - 1].name === 'Ada' && r.auth[r.auth.length - 1].photo === U1.photoURL, JSON.stringify(r));
  check('sign-in: the local progress is written up to saves/<uid> as the plain SAVE (the whole document, same shape as the claude doc, fits firestore.rules)', r.sets.length === 1 && r.sets[0] === 'saves/uid1' && r.doc && r.doc.best >= 3 && r.doc.coins === 40 && r.doc.nodes[ID[3]].entry === 41 && r.doc.v === 2 && Object.keys(r.doc).length < 40 && r.init && r.init.projectId === 'zb-test', JSON.stringify(r.doc));
  await page.close();
}
// ---- F4. sign in with an existing cloud doc: merged like the claude provider; booted already signed in
{
  const cloud = S({ best: 4, coins: 900, rev: 7, updatedAt: 5000, upgrades: { rate: 2 }, stages: { 2: { entry: 20, stars: 3 }, 4: { entry: 60, stars: 1 } } });
  const page = await openFb({ signInUser: U1, cloudDocs: { uid1: cloud } }, LOCAL1);
  await settle(page);
  const r = await page.evaluate(async () => { const z = window.__zb; await z.cloudSignIn(); await z.cloud.flush(); return { s: JSON.parse(JSON.stringify(z.SAVE)), doc: window.__fb.docs['saves/uid1'], merged: window.__events.filter(e => e.merged).length, st: z.cloud.state() }; });
  check('sign-in with a cloud doc: merged (best max, stars max, entry max, upgrades max, nodes union), coins from the newer copy (the cloud), merged cloudSync event', r.s.best === 4 && r.s.nodes[ID[2]].stars === 3 && r.s.nodes[ID[2]].entry === 30 && r.s.nodes[ID[3]].entry === 41 && r.s.nodes[ID[4]].entry === 60 && r.s.upgrades.rate === 2 && r.s.coins === 900 && r.merged >= 1 && r.st === 'synced', JSON.stringify(r.s));
  check('sign-in with a cloud doc: the merge went back to the cloud (it lacked n3a entry 41), rev moved past both', r.doc.nodes[ID[3]].entry === 41 && r.doc.rev > 7, JSON.stringify([r.doc.rev]));
  await page.close();
}
{
  const page = await openFb({ user: U1, signInUser: U1, cloudDocs: { uid1: S({ best: 2, coins: 7, rev: 3, updatedAt: 3000 }) } }, null);
  const r = await page.evaluate(async () => { const z = window.__zb; await z.cloud.flush(); window.__auth.length = 0; await z.cloud._inject(null); await z.cloud.flush(); return { st: z.cloud.state(), g: JSON.parse(JSON.stringify(z.G.cloud)), best: z.SAVE.best, coins: z.SAVE.coins, auth: window.__auth.slice() }; });
  check("booted already signed in: the cloud save is loaded (best 2, coins 7), state 'synced', account set, authState signedIn true", r.st === 'synced' && r.g.account && r.g.account.name === 'Ada' && r.best === 2 && r.coins === 7 && r.auth.some(a => a.signedIn), JSON.stringify(r));
  await page.close();
}
// ---- F5. a snapshot from another device
{
  const page = await openFb({ user: U1, signInUser: U1, cloudDocs: { uid1: S({ best: 2, coins: 7, rev: 3, updatedAt: 3000 }) } }, null);
  await settle(page);
  await page.evaluate(() => window.__fb.remoteWrite('uid1', Object.assign({ v: 2, coins: 55, best: 3, upgrades: {}, nodes: { n1: { entry: 1, stars: 3, cleared: true }, n2: { entry: 44, stars: 2, cleared: true } }, cur: 'n3a', rev: 9, updatedAt: 9000, epoch: 0 })));
  await page.waitForTimeout(150);
  const r = await page.evaluate(async () => { const z = window.__zb; await z.cloud.flush(); return { coins: z.SAVE.coins, best: z.SAVE.best, n2: z.SAVE.nodes.n2 && z.SAVE.nodes.n2.entry, merged: window.__events.filter(e => e.merged).length }; });
  check('snapshot from another device: applied (merged) while not in a run - coins 55, best 3, n2 entry 44', r.coins === 55 && r.best === 3 && r.n2 === 44 && r.merged >= 1, JSON.stringify(r));
  await page.close();
}
// ---- F6. sign out -> local
{
  const page = await openFb({ user: U1, signInUser: U1, cloudDocs: { uid1: S({ best: 2, coins: 7, rev: 3, updatedAt: 3000 }) } }, null);
  await settle(page);
  const r = await page.evaluate(async () => {
    const z = window.__zb; const sets0 = window.__fb.sets.length;
    const ok = await z.cloudSignOut();
    const st = z.cloud.state(), acct = z.G.cloud.account, last = window.__auth[window.__auth.length - 1];
    z.SAVE.coins += 99; z.saveGame(); await z.cloud.flush();
    const ep0 = z.SAVE.epoch; z.resetSave(); await z.cloud.flush();
    return { ok, st, acct, last, sets: window.__fb.sets.length - sets0, user: z.G.cloud.user, epochBumped: z.SAVE.epoch !== ep0, doc: window.__fb.docs['saves/uid1'].coins, calls: window.__fb.calls.slice() };
  });
  check("sign-out: state 'local', account null, authState { signedIn: false }, later saves and even a reset are local only (nothing written, epoch untouched, the cloud doc keeps its coins)", r.ok && r.st === 'local' && r.acct === null && r.last.signedIn === false && r.sets === 0 && r.user === false && !r.epochBumped && r.doc === 7 && r.calls.includes('signOut'), JSON.stringify(r));
  await page.close();
}
// ---- F7. popup blocked -> redirect; popup closed by the user -> quiet
{
  const page = await openFb({ signInUser: U1, popupError: 'auth/popup-blocked' }, LOCAL1);
  await settle(page);
  const r = await page.evaluate(async () => { const z = window.__zb; const ok = await z.cloudSignIn(); await new Promise(r => setTimeout(r, 150)); await z.cloud.flush(); return { ok, calls: window.__fb.calls.slice(), st: z.cloud.state() }; });
  check("sign-in: a blocked popup falls back to signInWithRedirect (popup, then redirect) and the user ends up signed in", r.ok === true && r.calls.join() === 'popup,redirect' && r.st === 'synced', JSON.stringify(r));
  await page.close();
}
{
  const page = await openFb({ signInUser: U1, popupError: 'auth/popup-closed-by-user' }, LOCAL1);
  await settle(page);
  const r = await page.evaluate(async () => { const z = window.__zb; const ok = await z.cloudSignIn(); return { ok, calls: window.__fb.calls.slice(), st: z.cloud.state(), errs: window.__auth.filter(a => a.error).length }; });
  check("sign-in: closing the popup is not an error - false, still 'local', no redirect, no error event", r.ok === false && r.calls.join() === 'popup' && r.st === 'local' && r.errs === 0, JSON.stringify(r));
  await page.close();
}
// ---- F8. errors map to the same states
{
  const page = await openFb({ user: U1, signInUser: U1, failSet: 'permission-denied', cloudDocs: {} }, LOCAL1);
  await page.waitForTimeout(100);
  const r = await page.evaluate(async () => { const z = window.__zb; await z.cloud.flush(); const st = z.cloud.state(); await new Promise(r => setTimeout(r, 2500)); z.SAVE.coins += 1; z.saveGame(); await z.cloud.flush(); return { st, sets: window.__fb.sets.length, st2: z.cloud.state() }; });
  check("firestore permission-denied: state 'error' for the visit, no retry loop (one write attempt, later saves do not try again)", r.st === 'error' && r.st2 === 'error' && r.sets === 1, JSON.stringify(r));
  await page.close();
}
{
  const page = await openFb({ user: U1, signInUser: U1, failSet: 'unavailable', cloudDocs: {} }, LOCAL1);
  await page.waitForTimeout(100);
  const r = await page.evaluate(async () => { const z = window.__zb; await new Promise(r => setTimeout(r, 2200)); return { st: z.cloud.state(), sets: window.__fb.sets.length }; });
  check("firestore unavailable: one quick retry, then 'pending' (not 'error')", r.st === 'pending' && r.sets >= 2 && r.sets <= 4, JSON.stringify(r));
  await page.close();
}
{
  const page = await openFb({ user: U1, signInUser: U1, failGet: 'unauthenticated', cloudDocs: {} }, LOCAL1);
  const r = await page.evaluate(async () => { const z = window.__zb; await z.cloud.flush(); return { st: z.cloud.state() }; });
  check("firestore unauthenticated: state 'local'", r.st === 'local', JSON.stringify(r));
  await page.close();
}
// ---- F9. lazy SDK loading
{
  const page = await openFb({ signInUser: U1 }, LOCAL1, { lazy: true });
  const r = await page.evaluate(async () => { await window.__zb.cloud.flush(); const z = window.__zb; const ok = await z.cloudSignIn(); await z.cloud.flush(); return { loaded: window.__fb && window.__fb.loaded.join(), ok, st: z.cloud.state(), srcs: [...document.querySelectorAll('script[src*=gstatic]')].map(s => s.src.split('/').pop()) }; });
  check("lazy SDK: the page loads firebase-app-compat, firebase-auth-compat and firebase-firestore-compat from gstatic (10.12.2) in that order, then signs in", r.srcs.join() === 'firebase-app-compat.js,firebase-auth-compat.js,firebase-firestore-compat.js' && r.loaded === 'app,auth,store' && r.ok === true && r.st === 'synced', JSON.stringify(r));
  await page.close();
}
{
  const page = await open(null, LOCAL1);
  const r = await page.evaluate(async () => { const z = window.__zb; return { signIn: await z.cloudSignIn(), signOut: await z.cloudSignOut(), prov: z.G.cloud.provider }; });
  check('cloudSignIn / cloudSignOut are harmless no-ops (false) when the provider is not firebase', r.signIn === false && r.signOut === false && r.prov === null, JSON.stringify(r));
  await page.close();
}
{
  const page = await open({}, S({ best: 3, rev: 1, updatedAt: 1 }));
  const r = await page.evaluate(async () => { const z = window.__zb; await z.cloud.flush(); return { prov: z.G.cloud.provider, auth: window.__auth || [], signIn: await z.cloudSignIn() }; });
  check("claude provider: G.cloud.provider is 'claude', cloudSignIn is a no-op", r.prov === 'claude' && r.signIn === false, JSON.stringify(r));
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
