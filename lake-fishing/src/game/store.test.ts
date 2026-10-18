import { describe, expect, it, vi } from "vitest";
import { createNewSave } from "../services";
import type { GameSave, SaveWriteResult } from "../services";
import { createInitialState } from "./state";
import { createGameStore } from "./store";

const T0 = 1_700_000_000_000;
const initial = () =>
  createInitialState({ load: { status: "loaded", save: createNewSave(T0), migratedFrom: null }, now: T0, rng: () => 0 });

describe("createGameStore", () => {
  it("persists the initial save and adopts the stamped copy as state", () => {
    const persist = vi.fn((save: GameSave): SaveWriteResult => ({ ok: true, save: { ...save, lastSavedAt: 5 } }));
    const store = createGameStore(initial(), persist);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(store.getState().save.lastSavedAt).toBe(5);
  });

  it("saves on every change of the save but not on pure clock ticks or taps", () => {
    const persist = vi.fn((save: GameSave): SaveWriteResult => ({ ok: true, save: { ...save } }));
    const store = createGameStore(initial(), persist);
    store.dispatch({ type: "tick", dtMs: 100, now: T0 + 100, rng: () => 0 });
    expect(persist).toHaveBeenCalledTimes(1);
    store.dispatch({ type: "updateSettings", patch: { musicEnabled: false } });
    expect(persist).toHaveBeenCalledTimes(2);
    expect(store.getState().save.settings.musicEnabled).toBe(false);
    store.dispatch({ type: "tap", now: T0 + 200 }); // no round: nothing changes
    expect(persist).toHaveBeenCalledTimes(2);
  });

  it("persists the heartbeat (markActive) and the hide stamp, but not a stale clock", () => {
    const persist = vi.fn((save: GameSave): SaveWriteResult => ({ ok: true, save: { ...save } }));
    const store = createGameStore(initial(), persist);
    store.dispatch({ type: "heartbeat", now: T0 + 30_000 });
    expect(persist).toHaveBeenCalledTimes(2);
    expect(persist.mock.calls[1][0].lastOfflineSettlementAt).toBe(T0 + 30_000);
    store.dispatch({ type: "hide", now: T0 + 31_000 });
    expect(persist).toHaveBeenCalledTimes(3);
    expect(persist.mock.calls[2][0].lastOfflineSettlementAt).toBe(T0 + 31_000);
    store.dispatch({ type: "heartbeat", now: T0 + 1_000 }); // clock went back: no change, no write
    expect(persist).toHaveBeenCalledTimes(3);
    expect(store.getState().save.lastOfflineSettlementAt).toBe(T0 + 31_000);
  });

  it("settles offline time before the first save, so the save cannot swallow the time away", () => {
    const old = { ...createNewSave(T0), lastOfflineSettlementAt: T0 - 3 * 3600 * 1000 };
    const persist = vi.fn((save: GameSave): SaveWriteResult => ({ ok: true, save }));
    const store = createGameStore(
      createInitialState({ load: { status: "loaded", save: old, migratedFrom: null }, now: T0, rng: () => 0 }),
      persist
    );
    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist.mock.calls[0][0].stats.totalCatches).toBeGreaterThan(0);
    expect(persist.mock.calls[0][0].lastOfflineSettlementAt).toBe(T0);
    expect(store.getState().notices[0]?.kind).toBe("offline");
  });

  it("flags a failed write and recovers on the next successful one", () => {
    let fail = true;
    const persist = (save: GameSave): SaveWriteResult => (fail ? { ok: false, error: new Error("full") } : { ok: true, save });
    const store = createGameStore(initial(), persist);
    expect(store.getState().saveOk).toBe(false);
    fail = false;
    store.dispatch({ type: "updateSettings", patch: { reducedMotion: true } });
    expect(store.getState().saveOk).toBe(true);
  });

  it("notifies subscribers once per effective dispatch and not for no-ops", () => {
    const store = createGameStore(initial(), (save) => ({ ok: true, save }));
    const listener = vi.fn();
    const off = store.subscribe(listener);
    store.dispatch({ type: "tap", now: T0 }); // no round yet: no change
    expect(listener).not.toHaveBeenCalled();
    store.dispatch({ type: "setTab", tab: "equipment" });
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    store.dispatch({ type: "setTab", tab: "lake" });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
