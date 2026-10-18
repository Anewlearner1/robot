import { describe, expect, it } from "vitest";
import { createNewSave, getFishingIntervalSeconds } from "../services";
import type { GameSave } from "../services";
import { saveWithDiscovered } from "../services/testUtils";
import { CATCH_FX_MS, MAX_LOG, createInitialState, gameReducer } from "./state";
import type { GameAction, GameState } from "./state";

const T0 = 1_700_000_000_000;
const LOW = () => 0; // always the first rarity / fish
const HIGH = () => 0.9999; // last unlocked rarity

function boot(save: GameSave = createNewSave(T0)): GameState {
  return createInitialState({ load: { status: "loaded", save, migratedFrom: null }, now: T0, rng: LOW });
}

function run(state: GameState, ...actions: GameAction[]): GameState {
  return actions.reduce(gameReducer, state);
}

/** Tick in 100 ms steps until `ms` of play time has passed. */
function play(state: GameState, ms: number, rng: () => number = LOW): GameState {
  let current = state;
  for (let elapsed = 0; elapsed < ms; elapsed += 100) {
    current = gameReducer(current, { type: "tick", dtMs: 100, now: current.now + 100, rng });
  }
  return current;
}

const intervalMs = (state: GameState) => getFishingIntervalSeconds(state.save.equipmentLevels.rod) * 1000;

/** A save with enough discoveries that legendary is unlocked (any HIGH roll is a rare+ fish). */
const veteran = () => ({ ...saveWithDiscovered(20, T0), lastActiveAt: T0 });

describe("createInitialState", () => {
  it("starts a new game when nothing is stored", () => {
    const state = createInitialState({ load: { status: "none" }, now: T0, rng: LOW });
    expect(state.save.coins).toBe(0);
    expect(state.dialogs).toEqual([]);
  });

  it("queues the corrupt-save notice with the backup key", () => {
    const state = createInitialState({
      load: { status: "corrupt", save: createNewSave(T0), backupKey: "lake-fishing-save-corrupt-1", reason: "x" },
      now: T0,
      rng: LOW
    });
    expect(state.dialogs).toEqual([{ kind: "corrupt", backupKey: "lake-fishing-save-corrupt-1" }]);
  });

  it("settles offline time at boot and queues the summary only when something was caught", () => {
    const old = { ...createNewSave(T0), lastActiveAt: T0 - 2 * 3600 * 1000 };
    const state = createInitialState({ load: { status: "loaded", save: old, migratedFrom: null }, now: T0, rng: LOW });
    expect(state.dialogs[0]?.kind).toBe("offline");
    expect(state.save.stats.totalCatches).toBeGreaterThan(0);
    expect(state.save.lastActiveAt).toBe(T0);

    const fresh = boot();
    expect(fresh.dialogs).toEqual([]);
  });
});

describe("idle fishing", () => {
  it("auto-catches one common fish per interval and logs it", () => {
    const start = boot();
    const after = play(start, intervalMs(start) + 200);
    expect(after.save.stats.totalCatches).toBe(1);
    expect(after.log).toHaveLength(1);
    expect(after.log[0].outcome).toBe("sold");
    expect(after.save.coins).toBeGreaterThan(0);
    expect(after.catchFx?.rarity).toBe("common");
    expect(after.sfx.names).toEqual(["catch"]);
  });

  it("does not catch before the interval has passed", () => {
    const start = boot();
    expect(play(start, intervalMs(start) - 1000).save.stats.totalCatches).toBe(0);
  });

  it("clears the scene effect after about two seconds", () => {
    const start = boot();
    const caught = play(start, intervalMs(start) + 200);
    expect(caught.catchFx).not.toBeNull();
    expect(play(caught, CATCH_FX_MS + 200).catchFx).toBeNull();
  });

  it("keeps only the last five log entries, newest first", () => {
    let state = boot();
    for (let i = 0; i < MAX_LOG + 2; i++) state = play(state, intervalMs(state) + 200);
    expect(state.log).toHaveLength(MAX_LOG);
    expect(state.log[0].id).toBeGreaterThan(state.log[1].id);
  });

  it("caps each tick so a long frame gap is not counted as play time", () => {
    const start = boot();
    const after = gameReducer(start, { type: "tick", dtMs: 3600_000, now: T0 + 3600_000, rng: LOW });
    expect(after.progressMs).toBeLessThan(5000);
    expect(after.save.stats.totalCatches).toBe(0);
  });
});

describe("rare+ bite prompt", () => {
  const bite = () => {
    const start = boot(veteran());
    const state = play(start, intervalMs(start) + 200, HIGH);
    return state;
  };

  it("opens a prompt instead of landing the fish and pauses the idle timer", () => {
    const state = bite();
    expect(state.mode.kind).toBe("prompt");
    expect(state.save.stats.totalCatches).toBe(20); // nothing landed yet
    const waited = play(state, 5000);
    expect(waited.mode.kind).toBe("prompt");
    expect(waited.progressMs).toBe(0);
  });

  it("auto-lands the fish (not perfect) after 15 seconds", () => {
    const state = bite();
    const waited = play(state, 15_200);
    expect(waited.mode.kind).toBe("idle");
    expect(waited.save.inventory).toHaveLength(1);
    expect(waited.save.inventory[0].perfect).toBe(false);
  });

  it("不理牠 lands it right away without a bonus", () => {
    const state = run(bite(), { type: "ignorePrompt", now: T0 });
    expect(state.mode.kind).toBe("idle");
    expect(state.save.inventory).toHaveLength(1);
    expect(state.save.inventory[0].perfect).toBe(false);
    expect(state.dialogs).toEqual([]);
  });

  it("收線 enters the minigame; success makes the fish perfect and shows a result", () => {
    const state = run(bite(), { type: "startReel", now: T0 + 1000 });
    expect(state.mode.kind).toBe("minigame");
    const done = run(state, { type: "finishMinigame", success: true, now: T0 + 9000 });
    expect(done.mode.kind).toBe("idle");
    expect(done.save.inventory[0].perfect).toBe(true);
    expect(done.dialogs[0]).toMatchObject({ kind: "catch", success: true });
    expect(done.sfx.names).toEqual(["minigame-success"]);
  });

  it("a failed round still keeps the fish, with no penalty", () => {
    const state = run(bite(), { type: "startReel", now: T0 + 1000 }, { type: "finishMinigame", success: false, now: T0 + 9000 });
    expect(state.save.inventory).toHaveLength(1);
    expect(state.save.inventory[0].perfect).toBe(false);
    expect(state.save.coins).toBe(veteran().coins);
    expect(state.dialogs[0]).toMatchObject({ kind: "catch", success: false });
  });

  it("ignores startReel / finishMinigame in the wrong mode", () => {
    const idle = boot();
    expect(gameReducer(idle, { type: "startReel", now: T0 })).toBe(idle);
    expect(gameReducer(idle, { type: "finishMinigame", success: true, now: T0 })).toBe(idle);
    expect(gameReducer(idle, { type: "ignorePrompt", now: T0 })).toBe(idle);
  });

  it("restarts the countdown from zero after the fish is landed", () => {
    const state = run(bite(), { type: "ignorePrompt", now: T0 });
    expect(state.progressMs).toBe(0);
  });
});

describe("visibility", () => {
  it("hide stamps lastActiveAt; show settles the time away and queues the summary", () => {
    const start = boot();
    const hidden = gameReducer(start, { type: "hide", now: T0 + 1000 });
    expect(hidden.save.lastActiveAt).toBe(T0 + 1000);
    const back = gameReducer(hidden, { type: "show", now: T0 + 1000 + 3 * 3600 * 1000, rng: LOW });
    expect(back.dialogs[0]?.kind).toBe("offline");
    expect(back.save.stats.totalCatches).toBeGreaterThan(0);
    expect(back.hiddenAt).toBeNull();
  });

  it("a short absence shows no dialog", () => {
    const hidden = gameReducer(boot(), { type: "hide", now: T0 + 1000 });
    const back = gameReducer(hidden, { type: "show", now: T0 + 31_000, rng: LOW });
    expect(back.dialogs).toEqual([]);
  });

  it("a minigame left in the background for a while lands the fish normally", () => {
    const start = boot(veteran());
    const prompting = play(start, intervalMs(start) + 200, HIGH);
    const reeling = gameReducer(prompting, { type: "startReel", now: prompting.now });
    const hidden = gameReducer(reeling, { type: "hide", now: prompting.now + 100 });
    const back = gameReducer(hidden, { type: "show", now: prompting.now + 100 + 60_000, rng: LOW });
    expect(back.mode.kind).toBe("idle");
    expect(back.save.inventory).toHaveLength(1);
    expect(back.save.inventory[0].perfect).toBe(false);
  });
});

describe("economy actions", () => {
  const withFish = () => {
    const start = boot(veteran());
    return run(play(start, intervalMs(start) + 200, HIGH), { type: "ignorePrompt", now: T0 });
  };

  it("sells one backpack item", () => {
    const state = withFish();
    const id = state.save.inventory[0].id;
    const sold = run(state, { type: "sell", itemId: id });
    expect(sold.save.inventory).toHaveLength(0);
    expect(sold.save.coins).toBeGreaterThan(state.save.coins);
    expect(sold.sfx.names).toEqual(["coin"]);
    expect(run(sold, { type: "sell", itemId: id })).toBe(sold);
  });

  it("sells everything and ignores an empty backpack", () => {
    const sold = run(withFish(), { type: "sellAll" });
    expect(sold.save.inventory).toHaveLength(0);
    expect(gameReducer(sold, { type: "sellAll" })).toBe(sold);
  });

  it("upgrades equipment only when affordable", () => {
    const poor = boot();
    const denied = run(poor, { type: "upgrade", equipment: "rod" });
    expect(denied.save.equipmentLevels.rod).toBe(1);
    expect(denied.toast?.text).toContain("金幣");

    const rich = boot({ ...createNewSave(T0), coins: 1000 });
    const bought = run(rich, { type: "upgrade", equipment: "rod" });
    expect(bought.save.equipmentLevels.rod).toBe(2);
    expect(bought.save.coins).toBe(900);
    expect(bought.sfx.names).toEqual(["upgrade"]);
  });
});

describe("settings, import and reset", () => {
  it("updates and clamps settings", () => {
    const state = run(boot(), { type: "updateSettings", patch: { musicVolume: 3, musicEnabled: false } });
    expect(state.save.settings.musicVolume).toBe(1);
    expect(state.save.settings.musicEnabled).toBe(false);
  });

  it("import replaces the save, clears transient state and gives no offline credit", () => {
    const imported = { ...saveWithDiscovered(6, T0), lastActiveAt: T0 - 5 * 3600 * 1000, coins: 77 };
    const state = run(boot(), { type: "importSave", save: imported, now: T0 + 5 });
    expect(state.save.coins).toBe(77);
    expect(state.save.lastActiveAt).toBe(T0 + 5);
    expect(state.log).toEqual([]);
  });

  it("reset starts over but keeps the sound settings", () => {
    const start = boot({ ...saveWithDiscovered(9, T0), coins: 500, settings: { musicEnabled: false, musicVolume: 0.2, reducedMotion: true } });
    const state = run(start, { type: "reset", now: T0 + 1 });
    expect(state.save.coins).toBe(0);
    expect(state.save.discoveredFishIds).toEqual([]);
    expect(state.save.settings).toEqual({ musicEnabled: false, musicVolume: 0.2, reducedMotion: true });
  });
});

describe("dialogs and toasts", () => {
  it("shows queued dialogs one at a time", () => {
    const state = createInitialState({
      load: { status: "corrupt", save: createNewSave(T0), backupKey: null, reason: "x" },
      now: T0,
      rng: LOW
    });
    expect(run(state, { type: "dismissDialog" }).dialogs).toEqual([]);
  });

  it("only dismisses the toast it was started for", () => {
    const state = run(boot({ ...createNewSave(T0), coins: 1000 }), { type: "upgrade", equipment: "rod" }, { type: "upgrade", equipment: "rod" });
    const current = run(state, { type: "upgrade", equipment: "bait" });
    expect(current.toast).not.toBeNull();
    expect(run(current, { type: "dismissToast", id: -1 }).toast).not.toBeNull();
  });
});
