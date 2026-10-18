import { describe, expect, it } from "vitest";
import { getFishById } from "../data/fish";
import {
  GAME_CONFIG,
  computeMinigameBonus,
  createNewSave,
  evaluateTap,
  getFishingIntervalSeconds,
  getSalePrice
} from "../services";
import type { GameSave, TapResult } from "../services";
import { saveWithDiscovered } from "../services/testUtils";
import {
  CATCH_FX_MS,
  MAX_LOG,
  MAX_NOTICES,
  TAP_FEEDBACK_MS,
  createInitialState,
  gameReducer,
  getPendingCount,
  getRoundElapsedMs
} from "./state";
import type { GameAction, GameState } from "./state";

const T0 = 1_700_000_000_000;
const LOW = () => 0; // first rarity / first fish / timing zone at the left end of the bar
const HIGH = () => 0.9999; // last unlocked rarity / fish / timing zone at the right end
const WINDOW_MS = GAME_CONFIG.minigame.windowSeconds * 1000;
const BONUS_CAP = GAME_CONFIG.minigame.bonusCap;

function boot(save: GameSave = createNewSave(T0)): GameState {
  return createInitialState({ load: { status: "loaded", save, migratedFrom: null }, now: T0, rng: LOW });
}

function run(state: GameState, ...actions: GameAction[]): GameState {
  return actions.reduce(gameReducer, state);
}

const tick = (state: GameState, rng: () => number = LOW, dtMs = 100) =>
  gameReducer(state, { type: "tick", dtMs, now: state.now + dtMs, rng });

/** Tick in 100 ms steps until `ms` of play time has passed. */
function play(state: GameState, ms: number, rng: () => number = LOW): GameState {
  let current = state;
  for (let elapsed = 0; elapsed < ms; elapsed += 100) current = tick(current, rng);
  return current;
}

const intervalMs = (state: GameState) => getFishingIntervalSeconds(state.save.equipmentLevels.rod) * 1000;

/** Tick until the timing window has just opened (a round exists). */
function playUntilWindow(state: GameState, rng: () => number = LOW): GameState {
  let current = state;
  for (let i = 0; i < 5000 && !current.round; i++) current = tick(current, rng);
  expect(current.round).not.toBeNull();
  return current;
}

/** Tick until one more fish has been caught. */
function playUntilCatch(state: GameState, rng: () => number = LOW): GameState {
  const before = state.save.stats.totalCatches;
  let current = state;
  for (let i = 0; i < 5000 && current.save.stats.totalCatches === before; i++) current = tick(current, rng);
  expect(current.save.stats.totalCatches).toBe(before + 1);
  return current;
}

/** The wall-clock `now` of the first moment (from now on) where an untapped round gives `result`. */
function tapMoment(state: GameState, result: TapResult): number {
  const round = state.round!;
  const from = getRoundElapsedMs(state);
  for (let at = from; at <= round.windowMs; at += 5) {
    if (evaluateTap({ ...round, tap: null }, at) === result) return state.now + (at - from);
  }
  throw new Error(`no ${result} moment left in this round`);
}

/** Tap at the first moment (from now on) where the indicator gives `result`. */
const tapFor = (state: GameState, result: TapResult): GameState =>
  gameReducer(state, { type: "tap", now: tapMoment(state, result) });

/** A save with enough discoveries that legendary is unlocked (a HIGH roll is then a legendary fish). */
const veteran = () => saveWithDiscovered(20, T0);

describe("createInitialState", () => {
  it("starts a new game when nothing is stored", () => {
    const state = createInitialState({ load: { status: "none" }, now: T0, rng: LOW });
    expect(state.save.coins).toBe(0);
    expect(state.notices).toEqual([]);
    expect(state.round).toBeNull();
  });

  it("queues the corrupt-save card with the backup key", () => {
    const state = createInitialState({
      load: { status: "corrupt", save: createNewSave(T0), backupKey: "lake-fishing-save-corrupt-1", reason: "x" },
      now: T0,
      rng: LOW
    });
    expect(state.notices).toEqual([{ id: 1, kind: "corrupt", backupKey: "lake-fishing-save-corrupt-1" }]);
  });

  it("settles offline time at boot and shows the summary card only when something was caught", () => {
    const old = { ...createNewSave(T0), lastOfflineSettlementAt: T0 - 2 * 3600 * 1000 };
    const state = createInitialState({ load: { status: "loaded", save: old, migratedFrom: null }, now: T0, rng: LOW });
    expect(state.notices[0]?.kind).toBe("offline");
    expect(state.save.stats.totalCatches).toBeGreaterThan(0);
    expect(state.save.lastOfflineSettlementAt).toBe(T0);

    expect(boot().notices).toEqual([]);
  });
});

describe("the countdown", () => {
  it("auto-catches one common fish per interval and logs it", () => {
    const start = boot();
    const after = play(start, intervalMs(start) + 200);
    expect(after.save.stats.totalCatches).toBe(1);
    expect(after.log).toHaveLength(1);
    expect(after.log[0]).toMatchObject({ outcome: "sold", bonusCoins: 0, minigameResult: "none" });
    expect(after.log[0].saleCoins).toBeGreaterThan(0);
    expect(after.save.coins).toBe(after.log[0].saleCoins);
    expect(after.catchFx?.rarity).toBe("common");
    expect(after.sfx.names).toEqual(["catch"]);
  });

  it("does not catch before the interval has passed", () => {
    const start = boot();
    expect(play(start, intervalMs(start) - 1000).save.stats.totalCatches).toBe(0);
  });

  it("clears the scene effect after about two seconds", () => {
    const caught = play(boot(), intervalMs(boot()) + 200);
    expect(caught.catchFx).not.toBeNull();
    expect(play(caught, CATCH_FX_MS + 200).catchFx).toBeNull();
  });

  it("keeps only the last five log entries, newest first", () => {
    let state = boot();
    for (let i = 0; i < MAX_LOG + 2; i++) state = playUntilCatch(state);
    expect(state.log).toHaveLength(MAX_LOG);
    expect(state.log[0].id).toBeGreaterThan(state.log[1].id);
  });

  it("caps each tick so a long frame gap is not counted as play time", () => {
    const after = gameReducer(boot(), { type: "tick", dtMs: 3600_000, now: T0 + 3600_000, rng: LOW });
    expect(after.progressMs).toBeLessThan(5000);
    expect(after.save.stats.totalCatches).toBe(0);
  });

  it("settles exactly once per countdown, over several countdowns", () => {
    const start = boot();
    const after = play(start, 3 * intervalMs(start) + 50);
    expect(after.save.stats.totalCatches).toBe(3);
    expect(after.log).toHaveLength(3);
  });
});

describe("bobber-timing window", () => {
  it("opens only in the last windowSeconds, plays a tick cue and never pauses the countdown", () => {
    const start = boot();
    const early = play(start, intervalMs(start) - WINDOW_MS - 200);
    expect(early.round).toBeNull();

    const opened = playUntilWindow(early);
    expect(opened.round?.windowMs).toBe(WINDOW_MS);
    expect(opened.sfx.names).toEqual(["minigame-tick"]);
    expect(intervalMs(opened) - opened.progressMs).toBeLessThanOrEqual(WINDOW_MS);
    expect(intervalMs(opened) - opened.progressMs).toBeGreaterThan(WINDOW_MS - 200);

    // The countdown keeps running inside the window, a tap does not touch it.
    const later = play(opened, 500);
    expect(later.progressMs).toBe(opened.progressMs + 500);
    expect(later.round).toBe(opened.round);
    const tapped = tapFor(later, "perfect");
    expect(tapped.progressMs).toBe(later.progressMs);
  });

  it("derives the elapsed time from the countdown so the window ends exactly when the catch settles", () => {
    const opened = playUntilWindow(boot());
    expect(getRoundElapsedMs(opened)).toBe(WINDOW_MS - (intervalMs(opened) - opened.progressMs));
    const nearEnd = play(opened, WINDOW_MS - getRoundElapsedMs(opened) - 100);
    expect(getRoundElapsedMs(nearEnd)).toBeGreaterThanOrEqual(WINDOW_MS - 100);
    expect(getRoundElapsedMs({ ...nearEnd, round: null })).toBe(0);
  });

  it("creates a fresh round for the next countdown", () => {
    const first = playUntilWindow(boot());
    const caught = playUntilCatch(first);
    expect(caught.round).toBeNull();
    const second = playUntilWindow(caught);
    expect(second.round).not.toBe(first.round);
  });

  it("a tap before the window is ignored", () => {
    const start = boot();
    expect(gameReducer(start, { type: "tap", now: T0 + 5 })).toBe(start);
  });
});

describe("tapping and settling with the minigame result", () => {
  it("a perfect tap gives instant feedback and settles once with source 'minigame' and the bonus", () => {
    const opened = playUntilWindow(boot(veteran()), HIGH);
    const tapped = tapFor(opened, "perfect");
    expect(tapped.round?.tap?.result).toBe("perfect");
    expect(tapped.tapFeedback).toMatchObject({ result: "perfect" });
    expect(tapped.sfx.names).toEqual(["minigame-success"]);
    expect(tapped.save.stats.totalCatches).toBe(20); // nothing settled yet

    const settled = playUntilCatch(tapped, HIGH);
    const row = settled.save.pendingFish[0];
    expect(settled.save.pendingFish).toHaveLength(1);
    expect(row.source).toBe("minigame");
    expect(settled.log[0]).toMatchObject({ outcome: "pending", minigameResult: "perfect", saleCoins: 0 });
    expect(settled.round).toBeNull();
    expect(settled.save.minigame.perfectStreak).toBe(1);

    // Settled exactly once: the following ticks add nothing.
    const after = play(settled, 1000, HIGH);
    expect(after.save.stats.totalCatches).toBe(21);
    expect(after.save.pendingFish).toEqual(settled.save.pendingFish);
  });

  it("success pays its bonus on top of the sale price", () => {
    const opened = playUntilWindow(boot());
    const settled = playUntilCatch(tapFor(opened, "success"));
    const fish = getFishById(settled.log[0].fishId)!;
    const bonus = computeMinigameBonus(fish, "success");
    expect(bonus).toBeGreaterThan(0);
    expect(settled.log[0]).toMatchObject({ saleCoins: getSalePrice(fish), bonusCoins: bonus, minigameResult: "success" });
    expect(settled.save.coins).toBe(getSalePrice(fish) + bonus);
    expect(settled.toast?.text).toContain(`+${bonus} 時機獎勵`);
  });

  it("a second tap is ignored: same state, the first result stands", () => {
    const opened = playUntilWindow(boot());
    const first = tapFor(opened, "perfect");
    const second = gameReducer(first, { type: "tap", now: tapMoment(opened, "miss") });
    expect(second).toBe(first);
    expect(first.round?.tap?.result).toBe("perfect");
    const again = gameReducer(first, { type: "tap", now: first.now + 10 });
    expect(again).toBe(first);
    const settled = playUntilCatch(first);
    expect(settled.log[0].minigameResult).toBe("perfect");
  });

  it("the bonus never exceeds the per-round cap, even for a perfect legendary", () => {
    const opened = playUntilWindow(boot(veteran()), HIGH);
    const before = opened.save.coins;
    const settled = playUntilCatch(tapFor(opened, "perfect"), HIGH);
    expect(getFishById(settled.log[0].fishId)!.rarity).toBe("legendary");
    expect(settled.log[0].bonusCoins).toBe(BONUS_CAP);
    expect(settled.log[0].bonusCoins).toBeLessThanOrEqual(25);
    expect(settled.save.coins - before).toBe(settled.log[0].bonusCoins); // pending fish: only the bonus
  });

  it("a miss costs nothing: no bonus, nothing taken, the fish is still caught", () => {
    const opened = playUntilWindow(boot());
    const tapped = tapFor(opened, "miss");
    expect(tapped.tapFeedback).toMatchObject({ result: "miss" });
    expect(tapped.sfx.names).toEqual(["minigame-fail"]);
    const settled = playUntilCatch(tapped);
    const fish = getFishById(settled.log[0].fishId)!;
    expect(settled.log[0]).toMatchObject({ bonusCoins: 0, minigameResult: "miss" });
    expect(settled.save.coins).toBe(getSalePrice(fish)); // exactly the sale price, never less
    expect(settled.save.stats.totalCatches).toBe(1);
    expect(settled.toast?.text ?? "").not.toContain("時機獎勵");
  });

  it("no tap settles as 'active' with the 'none' result and no bonus", () => {
    const opened = playUntilWindow(boot(veteran()), HIGH);
    const settled = playUntilCatch(opened, HIGH);
    expect(settled.save.pendingFish[0].source).toBe("active");
    expect(settled.log[0]).toMatchObject({ minigameResult: "none", bonusCoins: 0 });
    expect(settled.save.minigame.perfectStreak).toBe(0);
  });

  it("the feedback expires on its own", () => {
    const tapped = tapFor(playUntilWindow(boot()), "perfect");
    expect(tapped.tapFeedback).not.toBeNull();
    expect(play(tapped, TAP_FEEDBACK_MS + 200).tapFeedback).toBeNull();
  });

  it("shows a streak note on consecutive perfect rounds", () => {
    let state = boot(veteran());
    for (let i = 0; i < 2; i++) state = playUntilCatch(tapFor(playUntilWindow(state, HIGH), "perfect"), HIGH);
    expect(state.save.minigame.perfectStreak).toBe(2);
    expect(state.toast?.text).toContain("連續完美 ×2");
  });
});

describe("rare catches, banners and the fish bag", () => {
  const withRare = () => playUntilCatch(boot(veteran()), HIGH);

  it("a rare+ catch goes to 待處理 and raises a dismissible banner", () => {
    const state = withRare();
    expect(state.save.pendingFish).toHaveLength(1);
    expect(getPendingCount(state.save)).toBe(1);
    expect(state.notices).toHaveLength(1);
    expect(state.notices[0]).toMatchObject({ kind: "rare", fishId: state.save.pendingFish[0].fishId });
    expect(state.sfx.names).toEqual(["legendary"]);
    const gone = run(state, { type: "dismissNotice", id: state.notices[0].id });
    expect(gone.notices).toEqual([]);
    expect(run(gone, { type: "dismissNotice", id: 99 })).toBe(gone);
  });

  it("pending -> keep -> sell, each step exactly once", () => {
    const state = withRare();
    const pending = state.save.pendingFish[0];
    const fish = getFishById(pending.fishId)!;

    const kept = run(state, { type: "keepPending", id: pending.id });
    expect(kept.save.pendingFish).toEqual([]);
    expect(kept.save.fishInventory[fish.id]).toBe(1);
    expect(kept.save.coins).toBe(state.save.coins);
    expect(kept.notices).toEqual([]); // the banner is stale once the fish is decided
    expect(run(kept, { type: "keepPending", id: pending.id })).toBe(kept); // double click

    const sold = run(kept, { type: "sellInventory", fishId: fish.id, qty: 1 });
    expect(sold.save.fishInventory).toEqual({});
    expect(sold.save.coins).toBe(kept.save.coins + fish.sellPrice);
    expect(sold.save.discoveredFishIds).toContain(fish.id); // selling never touches the encyclopedia
    expect(sold.sfx.names).toEqual(["coin"]);
    expect(run(sold, { type: "sellInventory", fishId: fish.id, qty: 1 })).toBe(sold);
  });

  it("sells a pending row directly, once, and supports a partial quantity", () => {
    let state = withRare();
    state = playUntilCatch(state, HIGH); // same fish, same source: the row merges
    const row = state.save.pendingFish[0];
    expect(row.quantity).toBe(2);
    const fish = getFishById(row.fishId)!;

    const one = run(state, { type: "sellPending", id: row.id, qty: 1 });
    expect(one.save.pendingFish[0].quantity).toBe(1);
    expect(one.save.coins).toBe(state.save.coins + fish.sellPrice);

    const rest = run(one, { type: "sellPending", id: row.id });
    expect(rest.save.pendingFish).toEqual([]);
    expect(rest.notices).toEqual([]);
    expect(run(rest, { type: "sellPending", id: row.id })).toBe(rest);
  });

  it("sell-all works on both lists and does nothing when empty", () => {
    const base = withRare();
    const row = base.save.pendingFish[0];
    const fish = getFishById(row.fishId)!;
    const pendingSold = run(base, { type: "sellAllPending" });
    expect(pendingSold.save.pendingFish).toEqual([]);
    expect(pendingSold.save.coins).toBe(base.save.coins + fish.sellPrice);
    expect(run(pendingSold, { type: "sellAllPending" })).toBe(pendingSold);

    const keptSold = run(base, { type: "keepPending", id: row.id }, { type: "sellAllInventory" });
    expect(keptSold.save.fishInventory).toEqual({});
    expect(keptSold.save.coins).toBe(base.save.coins + fish.sellPrice);
    expect(run(keptSold, { type: "sellAllInventory" })).toBe(keptSold);
  });

  it("arriving at 魚包 clears the rare banners, and the notice list stays small", () => {
    const state = withRare();
    expect(run(state, { type: "setTab", tab: "bag" }).notices).toEqual([]);

    let crowded = boot(veteran());
    for (let i = 0; i < MAX_NOTICES + 2; i++) crowded = playUntilCatch(crowded, HIGH);
    expect(crowded.notices.length).toBeLessThanOrEqual(MAX_NOTICES);
  });
});

describe("visibility, heartbeat and offline", () => {
  it("hide marks the player active (markActive): the timestamp moves forward only", () => {
    const hidden = gameReducer(boot(), { type: "hide", now: T0 + 1000 });
    expect(hidden.save.lastOfflineSettlementAt).toBe(T0 + 1000);
    const backwards = gameReducer(hidden, { type: "hide", now: T0 + 500 });
    expect(backwards.save).toBe(hidden.save); // a clock that went back never rewinds the stamp
  });

  it("the heartbeat advances lastOfflineSettlementAt and never moves it back", () => {
    const start = boot();
    const beat = gameReducer(start, { type: "heartbeat", now: T0 + 30_000 });
    expect(beat.save.lastOfflineSettlementAt).toBe(T0 + 30_000);
    expect(beat.save.stats).toEqual(start.save.stats); // credits nothing
    expect(gameReducer(beat, { type: "heartbeat", now: T0 + 10_000 })).toBe(beat);
    expect(gameReducer(beat, { type: "heartbeat", now: T0 + 30_000 })).toBe(beat);
  });

  it("show settles the time away and shows the summary card", () => {
    const hidden = gameReducer(boot(), { type: "hide", now: T0 + 1000 });
    const back = gameReducer(hidden, { type: "show", now: T0 + 1000 + 3 * 3600 * 1000, rng: LOW });
    expect(back.notices[0]?.kind).toBe("offline");
    expect(back.save.stats.totalCatches).toBeGreaterThan(0);
    expect(back.save.lastOfflineSettlementAt).toBe(T0 + 1000 + 3 * 3600 * 1000);
    // Settled once: showing again at the same moment pays nothing more.
    const again = gameReducer(back, { type: "show", now: back.now, rng: LOW });
    expect(again.save.stats.totalCatches).toBe(back.save.stats.totalCatches);
    expect(again.notices).toHaveLength(1);
  });

  it("offline rare+ fish land in 待處理 with source 'offline'", () => {
    const hidden = gameReducer(boot(veteran()), { type: "hide", now: T0 });
    const back = gameReducer(hidden, { type: "show", now: T0 + 4 * 3600 * 1000, rng: HIGH });
    expect(back.save.pendingFish.length).toBeGreaterThan(0);
    expect(back.save.pendingFish.every((row) => row.source === "offline")).toBe(true);
    expect(back.notices[0]).toMatchObject({ kind: "offline" });
  });

  it("a short absence shows no card", () => {
    const hidden = gameReducer(boot(), { type: "hide", now: T0 + 1000 });
    const back = gameReducer(hidden, { type: "show", now: T0 + 31_000, rng: LOW });
    expect(back.notices).toEqual([]);
  });

  it("a clock that went backwards pays nothing", () => {
    const hidden = gameReducer(boot(), { type: "hide", now: T0 + 10 * 3600 * 1000 });
    const back = gameReducer(hidden, { type: "show", now: T0, rng: LOW });
    expect(back.save.stats.totalCatches).toBe(0);
    expect(back.save.lastOfflineSettlementAt).toBe(T0 + 10 * 3600 * 1000);
  });

  it("the countdown carries on across a hide/show without disturbing a running round", () => {
    const opened = tapFor(playUntilWindow(boot()), "perfect");
    const hidden = gameReducer(opened, { type: "hide", now: opened.now + 100 });
    const back = gameReducer(hidden, { type: "show", now: opened.now + 100 + 60_000, rng: LOW });
    expect(back.progressMs).toBe(opened.progressMs);
    expect(back.round).toBe(opened.round);
    expect(getRoundElapsedMs(back)).toBe(getRoundElapsedMs(opened));
  });
});

describe("equipment", () => {
  it("upgrades only when affordable", () => {
    const denied = run(boot(), { type: "upgrade", equipment: "rod" });
    expect(denied.save.equipmentLevels.rod).toBe(1);
    expect(denied.toast?.text).toContain("金幣");

    const rich = boot({ ...createNewSave(T0), coins: 1000 });
    const bought = run(rich, { type: "upgrade", equipment: "rod" });
    expect(bought.save.equipmentLevels.rod).toBe(2);
    expect(bought.save.coins).toBe(900);
    expect(bought.sfx.names).toEqual(["upgrade"]);
  });

  it("a faster rod shortens the next countdown", () => {
    const rich = run(boot({ ...createNewSave(T0), coins: 1000 }), { type: "upgrade", equipment: "rod" });
    expect(intervalMs(rich)).toBeLessThan(GAME_CONFIG.rod.baseIntervalSeconds * 1000);
    expect(play(rich, intervalMs(rich) + 200).save.stats.totalCatches).toBe(1);
  });
});

describe("settings, import and reset", () => {
  it("updates and clamps settings, including soundEnabled", () => {
    const state = run(boot(), { type: "updateSettings", patch: { musicVolume: 3, musicEnabled: false, soundEnabled: false } });
    expect(state.save.settings.musicVolume).toBe(1);
    expect(state.save.settings.musicEnabled).toBe(false);
    expect(state.save.settings.soundEnabled).toBe(false);
  });

  it("import replaces the save, clears transient state and gives no offline credit", () => {
    const running = tapFor(playUntilWindow(boot()), "perfect");
    const imported = { ...saveWithDiscovered(6, T0), lastOfflineSettlementAt: T0 - 5 * 3600 * 1000, coins: 77 };
    const state = run(running, { type: "importSave", save: imported, now: T0 + 5 + 100_000 });
    expect(state.save.coins).toBe(77);
    expect(state.save.lastOfflineSettlementAt).toBe(T0 + 5 + 100_000);
    expect(state.log).toEqual([]);
    expect(state.round).toBeNull();
    expect(state.tapFeedback).toBeNull();
  });

  it("reset starts over but keeps the settings", () => {
    const settings = { soundEnabled: false, musicEnabled: false, musicVolume: 0.2, reducedMotion: true };
    const start = boot({ ...saveWithDiscovered(9, T0), coins: 500, settings });
    const state = run(start, { type: "reset", now: T0 + 1 });
    expect(state.save.coins).toBe(0);
    expect(state.save.discoveredFishIds).toEqual([]);
    expect(state.save.settings).toEqual(settings);
  });
});

describe("toasts", () => {
  it("only dismisses the toast it was started for", () => {
    const state = run(boot({ ...createNewSave(T0), coins: 1000 }), { type: "upgrade", equipment: "rod" }, { type: "upgrade", equipment: "rod" });
    const current = run(state, { type: "upgrade", equipment: "bait" });
    expect(current.toast).not.toBeNull();
    expect(run(current, { type: "dismissToast", id: -1 }).toast).not.toBeNull();
    expect(run(current, { type: "dismissToast", id: current.toast!.id }).toast).toBeNull();
  });
});
