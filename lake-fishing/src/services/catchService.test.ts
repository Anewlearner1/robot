import { describe, expect, it } from "vitest";
import { FISH } from "../data/fish";
import type { CatchSource, GameSave, MinigameResult } from "../types/game";
import {
  applyCatch,
  getInventoryEntries,
  getInventoryValue,
  getPendingEntries,
  getPendingValue,
  keepPending,
  sellAllInventory,
  sellAllPending,
  sellInventoryFish,
  sellPending
} from "./catchService";
import { createNewSave, validateSave } from "./saveService";
import { FISH_IDS, saveWithDiscovered } from "./testUtils";

const CARP = "fish_carp"; // common, 8
const CATFISH = "fish_catfish"; // uncommon, 12
const KOI = "fish_koi"; // rare, 50
const STURGEON = "fish_sturgeon"; // rare, 45
const MOON = "fish_moonlight_carp"; // epic, 100
const GUARDIAN = "fish_lake_guardian"; // legendary, 500
const NOW = 5_000_000;

const catchFish = (save: GameSave, id: string, source: CatchSource = "active", minigame?: MinigameResult) =>
  applyCatch(save, id, { source, now: NOW, ...(minigame ? { minigame: { result: minigame } } : {}) });

/** A save with 1 koi + 1 guardian pending, plus 3 sturgeon kept. */
const holding = (): GameSave => {
  let save = saveWithDiscovered(20);
  save = catchFish(save, KOI).save;
  save = catchFish(save, GUARDIAN).save;
  save = { ...save, fishInventory: { [STURGEON]: 3 } };
  return save;
};

describe("applyCatch: auto-sell vs pending", () => {
  it("auto-sells common fish at exactly sellPrice and registers them", () => {
    const { save, event } = catchFish(createNewSave(1), CARP);
    expect(event.outcome).toBe("sold");
    expect(event.coinsEarned).toBe(8);
    expect(event).toMatchObject({ saleCoins: 8, bonusCoins: 0, minigameResult: null, pendingFish: null });
    expect(event.isNewDiscovery).toBe(true);
    expect(save.coins).toBe(8);
    expect(save.pendingFish).toEqual([]);
    expect(save.fishInventory).toEqual({});
    expect(save.discoveredFishIds).toEqual([CARP]);
    expect(save.catchCounts).toEqual({ [CARP]: 1 });
    expect(save.stats).toEqual({ totalCatches: 1, totalFishSold: 1, totalCoinsEarned: 8 });
  });

  it("auto-sells uncommon fish too", () => {
    const { save, event } = catchFish(saveWithDiscovered(5), CATFISH);
    expect(event.outcome).toBe("sold");
    expect(save.coins).toBe(12);
  });

  it.each([KOI, MOON, GUARDIAN])("puts %s into pendingFish without paying coins", (id) => {
    const start = saveWithDiscovered(20);
    const { save, event } = catchFish(start, id);
    expect(event.outcome).toBe("pending");
    expect(event.coinsEarned).toBe(0);
    expect(save.coins).toBe(0);
    expect(save.pendingFish).toHaveLength(1);
    expect(save.pendingFish[0]).toEqual({ id: "pending_0", fishId: id, quantity: 1, caughtAt: NOW, source: "active" });
    expect(event.pendingFish).toEqual(save.pendingFish[0]);
    expect(save.fishInventory).toEqual({});
    expect(save.stats.totalFishSold).toBe(0);
    expect(save.stats.totalCatches).toBe(start.stats.totalCatches + 1);
  });

  it("never applies a bait multiplier to the sale price", () => {
    for (let bait = 1; bait <= 6; bait++) {
      const save = { ...createNewSave(1), equipmentLevels: { rod: 1, line: 1, bait } };
      expect(catchFish(save, CARP).event.coinsEarned).toBe(8);
    }
  });

  it("merges the same fish and source, keeps different sources apart", () => {
    let save = saveWithDiscovered(20);
    save = catchFish(save, KOI, "active").save;
    save = applyCatch(save, KOI, { source: "active", now: NOW + 10 }).save;
    expect(save.pendingFish).toEqual([{ id: "pending_0", fishId: KOI, quantity: 2, caughtAt: NOW + 10, source: "active" }]);
    save = applyCatch(save, KOI, { source: "offline", now: NOW + 20 }).save;
    save = catchFish(save, GUARDIAN, "active").save;
    expect(save.pendingFish.map((row) => [row.fishId, row.source, row.quantity])).toEqual([
      [KOI, "active", 2],
      [KOI, "offline", 1],
      [GUARDIAN, "active", 1]
    ]);
    expect(new Set(save.pendingFish.map((row) => row.id)).size).toBe(3);
    expect(validateSave(save)).toBe(true);
  });

  it("gives every pending row a unique id, even across sells and a stale counter", () => {
    let save = saveWithDiscovered(20);
    save = catchFish(save, KOI).save;
    save = catchFish(save, GUARDIAN).save;
    const sold = sellPending(save, save.pendingFish[1].id);
    if (!sold.ok) throw new Error("unreachable");
    save = catchFish(sold.save, GUARDIAN).save;
    expect(new Set(save.pendingFish.map((row) => row.id)).size).toBe(save.pendingFish.length);
    const stale = catchFish({ ...save, nextPendingId: 0 }, MOON).save;
    expect(new Set(stale.pendingFish.map((row) => row.id)).size).toBe(stale.pendingFish.length);
  });

  it("throws on an unknown fish id", () => {
    expect(() => catchFish(createNewSave(1), "fish_cultrure")).toThrow();
  });
});

describe("applyCatch: minigame bonus", () => {
  it("pays the bonus on top of the sale price and counts it in totalCoinsEarned", () => {
    // carp 8: perfect ceil(8 * 0.5) = 4, success ceil(8 * 0.2) = 2
    const perfect = catchFish(createNewSave(1), CARP, "minigame", "perfect");
    expect(perfect.event).toMatchObject({ saleCoins: 8, bonusCoins: 4, coinsEarned: 12, minigameResult: "perfect" });
    expect(perfect.save.coins).toBe(12);
    expect(perfect.save.stats).toEqual({ totalCatches: 1, totalFishSold: 1, totalCoinsEarned: 12 });
    const success = catchFish(createNewSave(1), CARP, "minigame", "success");
    expect(success.event).toMatchObject({ bonusCoins: 2, coinsEarned: 10 });
    expect(success.save.coins).toBe(10);
  });

  it("pays the bonus for a pending (rare+) fish too, capped at 25", () => {
    const { save, event } = catchFish(saveWithDiscovered(20), GUARDIAN, "minigame", "perfect");
    expect(event).toMatchObject({ outcome: "pending", saleCoins: 0, bonusCoins: 25, coinsEarned: 25 });
    expect(save.coins).toBe(25);
    expect(save.stats.totalCoinsEarned).toBe(25);
    expect(save.stats.totalFishSold).toBe(0);
    expect(save.pendingFish[0].source).toBe("minigame");
  });

  it("a miss or no tap costs nothing and loses nothing", () => {
    for (const result of ["miss", "none"] as const) {
      const start = { ...saveWithDiscovered(20), coins: 100 };
      const { save, event } = catchFish(start, KOI, "minigame", result);
      expect(event.bonusCoins).toBe(0);
      expect(save.coins).toBe(100);
      expect(save.pendingFish).toHaveLength(1); // the fish is still caught
      expect(save.stats.totalCatches).toBe(start.stats.totalCatches + 1);
    }
  });

  it("without a minigame outcome no bonus is paid and the streak is untouched", () => {
    const start = { ...createNewSave(1), minigame: { perfectStreak: 3 } };
    const { save, event } = catchFish(start, CARP);
    expect(event.bonusCoins).toBe(0);
    expect(save.minigame.perfectStreak).toBe(3);
    expect(event.perfectStreak).toEqual({ before: 3, after: 3 });
  });

  it("updates the perfect streak: perfect +1, everything else resets", () => {
    let save = createNewSave(1);
    save = catchFish(save, CARP, "minigame", "perfect").save;
    save = catchFish(save, CARP, "minigame", "perfect").save;
    expect(save.minigame.perfectStreak).toBe(2);
    const success = catchFish(save, CARP, "minigame", "success");
    expect(success.save.minigame.perfectStreak).toBe(0);
    expect(success.event.perfectStreak).toEqual({ before: 2, after: 0 });
    expect(catchFish(save, CARP, "minigame", "miss").save.minigame.perfectStreak).toBe(0);
    expect(catchFish(save, CARP, "active", "none").save.minigame.perfectStreak).toBe(0);
  });

  it("the streak never touches the pity counter", () => {
    const start = { ...saveWithDiscovered(20), pity: { consecutiveNonLegendary: 10 } };
    const { save } = catchFish({ ...start, minigame: { perfectStreak: 50 } }, CARP, "minigame", "perfect");
    expect(save.pity.consecutiveNonLegendary).toBe(11);
  });
});

describe("applyCatch: discovery and stats", () => {
  it("counts per species and only discovers once", () => {
    const first = catchFish(createNewSave(1), CARP);
    expect(first.event.speciesCatchCount).toBe(1);
    const second = catchFish(first.save, CARP);
    expect(second.event.isNewDiscovery).toBe(false);
    expect(second.event.speciesCatchCount).toBe(2);
    expect(second.save.discoveredFishIds).toEqual([CARP]);
    expect(second.save.catchCounts[CARP]).toBe(2);
    expect(second.save.stats.totalCatches).toBe(2);
    expect(second.save.stats.totalCoinsEarned).toBe(16);
    expect(validateSave(second.save)).toBe(true);
  });

  it("registers a rare fish in the encyclopedia even though it is pending, and reports unlocks", () => {
    const { save, event } = catchFish(saveWithDiscovered(9), FISH_IDS[9]);
    expect(event.isNewDiscovery).toBe(true);
    expect(save.discoveredFishIds).toHaveLength(10);
    expect(event.newlyUnlockedRarities).toEqual(["rare"]);
  });

  it("reports no unlocks for repeat catches", () => {
    expect(catchFish(saveWithDiscovered(10), FISH_IDS[0]).event.newlyUnlockedRarities).toEqual([]);
  });

  it("is immutable", () => {
    const start = saveWithDiscovered(20);
    const snapshot = JSON.stringify(start);
    catchFish(start, KOI, "minigame", "perfect");
    catchFish(start, CARP);
    expect(JSON.stringify(start)).toBe(snapshot);
  });

  it("produces saves that pass full validation", () => {
    let save = createNewSave(1);
    for (const id of FISH_IDS) save = catchFish(save, id, "minigame", "success").save;
    expect(validateSave(save)).toBe(true);
    expect(save.discoveredFishIds).toHaveLength(25);
  });
});

describe("applyCatch: pity counter", () => {
  it("does not count while legendary is locked", () => {
    let save = saveWithDiscovered(19);
    for (let i = 0; i < 5; i++) save = catchFish(save, CARP).save;
    expect(save.pity.consecutiveNonLegendary).toBe(0);
  });

  it("increments on every non-legendary catch once legendary is unlocked", () => {
    const save = saveWithDiscovered(20);
    const e1 = catchFish(save, CARP);
    expect(e1.event.pity).toEqual({ before: 0, after: 1, reset: false });
    const e2 = catchFish(e1.save, KOI);
    expect(e2.event.pity).toEqual({ before: 1, after: 2, reset: false });
    expect(e2.save.pity.consecutiveNonLegendary).toBe(2);
  });

  it("resets to 0 on a legendary", () => {
    const save = { ...saveWithDiscovered(20), pity: { consecutiveNonLegendary: 77 } };
    const { save: after, event } = catchFish(save, GUARDIAN);
    expect(after.pity.consecutiveNonLegendary).toBe(0);
    expect(event.pity).toEqual({ before: 77, after: 0, reset: true });
  });

  it("does not count the catch that itself unlocks legendary", () => {
    const { save } = catchFish(saveWithDiscovered(19), FISH_IDS[19]);
    expect(save.discoveredFishIds).toHaveLength(20);
    expect(save.pity.consecutiveNonLegendary).toBe(0);
    expect(catchFish(save, CARP).save.pity.consecutiveNonLegendary).toBe(1);
  });
});

describe("sellPending", () => {
  it("sells a whole row at sellPrice and updates coins and stats", () => {
    const save = holding();
    const koi = save.pendingFish[0];
    const result = sellPending(save, koi.id);
    if (!result.ok) throw new Error("unreachable");
    expect(result).toMatchObject({ fishId: KOI, soldCount: 1, coinsEarned: 50 });
    expect(result.save.coins).toBe(50);
    expect(result.save.pendingFish.map((row) => row.fishId)).toEqual([GUARDIAN]);
    expect(result.save.stats.totalFishSold).toBe(1);
    expect(result.save.stats.totalCoinsEarned).toBe(50);
    expect(save.pendingFish).toHaveLength(2); // input untouched
    expect(validateSave(result.save)).toBe(true);
  });

  it("sells part of a merged row and leaves the rest", () => {
    let save = saveWithDiscovered(20);
    for (let i = 0; i < 3; i++) save = catchFish(save, KOI).save;
    const row = save.pendingFish[0];
    expect(row.quantity).toBe(3);
    const result = sellPending(save, row.id, 2);
    if (!result.ok) throw new Error("unreachable");
    expect(result.coinsEarned).toBe(100);
    expect(result.save.pendingFish).toEqual([{ ...row, quantity: 1 }]);
    expect(result.save.stats.totalFishSold).toBe(2);
  });

  it("leaves the encyclopedia untouched", () => {
    const save = holding();
    const result = sellPending(save, save.pendingFish[0].id);
    if (!result.ok) throw new Error("unreachable");
    expect(result.save.discoveredFishIds).toEqual(save.discoveredFishIds);
    expect(result.save.catchCounts).toEqual(save.catchCounts);
    expect(result.save.stats.totalCatches).toBe(save.stats.totalCatches);
  });

  it("a double click sells once: the second request fails and changes nothing", () => {
    const save = holding();
    const id = save.pendingFish[0].id;
    const first = sellPending(save, id);
    if (!first.ok) throw new Error("unreachable");
    const second = sellPending(first.save, id);
    expect(second).toEqual({ ok: false, reason: "NOT_FOUND", save: first.save });
    expect(second.save.coins).toBe(50);
  });

  it.each([
    ["zero", 0, "INVALID_QUANTITY"],
    ["negative", -1, "INVALID_QUANTITY"],
    ["fractional", 1.5, "INVALID_QUANTITY"],
    ["NaN", Number.NaN, "INVALID_QUANTITY"],
    ["Infinity", Infinity, "INVALID_QUANTITY"],
    ["more than held", 2, "INSUFFICIENT_QUANTITY"]
  ])("refuses %s quantity without changing the save", (_name, qty, reason) => {
    const save = holding();
    const result = sellPending(save, save.pendingFish[0].id, qty);
    expect(result).toEqual({ ok: false, reason, save });
    expect(result.save).toBe(save);
  });

  it("refuses an unknown id and a row that points at an unknown fish", () => {
    const save = holding();
    expect(sellPending(save, "nope")).toEqual({ ok: false, reason: "NOT_FOUND", save });
    const broken = { ...save, pendingFish: [{ ...save.pendingFish[0], fishId: "fish_unicorn" }] };
    expect(sellPending(broken, broken.pendingFish[0].id)).toEqual({ ok: false, reason: "UNKNOWN_FISH", save: broken });
  });

  it("never produces a negative or non-integer value across a sell sequence", () => {
    let save = saveWithDiscovered(20);
    for (let i = 0; i < 4; i++) save = catchFish(save, i % 2 ? KOI : MOON).save;
    for (const row of [...save.pendingFish]) {
      const result = sellPending(save, row.id, row.quantity);
      if (result.ok) save = result.save;
    }
    expect(save.pendingFish).toEqual([]);
    expect(save.coins).toBe(2 * 50 + 2 * 100);
    expect(Number.isInteger(save.coins) && save.coins >= 0).toBe(true);
  });
});

describe("keepPending", () => {
  it("moves a row into fishInventory without coins", () => {
    const save = holding();
    const result = keepPending(save, save.pendingFish[0].id);
    if (!result.ok) throw new Error("unreachable");
    expect(result).toMatchObject({ fishId: KOI, keptCount: 1 });
    expect(result.save.fishInventory).toEqual({ [STURGEON]: 3, [KOI]: 1 });
    expect(result.save.pendingFish.map((row) => row.fishId)).toEqual([GUARDIAN]);
    expect(result.save.coins).toBe(save.coins);
    expect(result.save.stats).toEqual(save.stats);
    expect(validateSave(result.save)).toBe(true);
  });

  it("keeps part of a row and adds to an existing count", () => {
    let save = saveWithDiscovered(20);
    for (let i = 0; i < 3; i++) save = catchFish(save, KOI).save;
    save = { ...save, fishInventory: { [KOI]: 2 } };
    const result = keepPending(save, save.pendingFish[0].id, 2);
    if (!result.ok) throw new Error("unreachable");
    expect(result.save.fishInventory[KOI]).toBe(4);
    expect(result.save.pendingFish[0].quantity).toBe(1);
  });

  it("refuses bad requests and a double click", () => {
    const save = holding();
    const id = save.pendingFish[0].id;
    expect(keepPending(save, id, 0)).toEqual({ ok: false, reason: "INVALID_QUANTITY", save });
    expect(keepPending(save, id, 5)).toEqual({ ok: false, reason: "INSUFFICIENT_QUANTITY", save });
    expect(keepPending(save, "nope")).toEqual({ ok: false, reason: "NOT_FOUND", save });
    const first = keepPending(save, id);
    if (!first.ok) throw new Error("unreachable");
    expect(keepPending(first.save, id).ok).toBe(false);
    expect(first.save.fishInventory[KOI]).toBe(1); // not 2
  });

  it("conserves fish: pending + kept stays the same", () => {
    const save = holding();
    const total = (s: GameSave) =>
      s.pendingFish.reduce((sum, row) => sum + row.quantity, 0) + Object.values(s.fishInventory).reduce((a, b) => a + b, 0);
    const result = keepPending(save, save.pendingFish[1].id);
    if (!result.ok) throw new Error("unreachable");
    expect(total(result.save)).toBe(total(save));
  });
});

describe("sellInventoryFish", () => {
  it("sells some kept fish at sellPrice and keeps the rest", () => {
    const save = holding();
    const result = sellInventoryFish(save, STURGEON, 2);
    if (!result.ok) throw new Error("unreachable");
    expect(result).toMatchObject({ fishId: STURGEON, soldCount: 2, coinsEarned: 90 });
    expect(result.save.fishInventory).toEqual({ [STURGEON]: 1 });
    expect(result.save.coins).toBe(90);
    expect(result.save.stats.totalFishSold).toBe(2);
    expect(result.save.stats.totalCoinsEarned).toBe(90);
    expect(result.save.discoveredFishIds).toEqual(save.discoveredFishIds);
    expect(validateSave(result.save)).toBe(true);
  });

  it("removes the species when everything is sold", () => {
    const result = sellInventoryFish(holding(), STURGEON, 3);
    if (!result.ok) throw new Error("unreachable");
    expect(result.save.fishInventory).toEqual({});
    expect(STURGEON in result.save.fishInventory).toBe(false);
  });

  it("a double click cannot sell more than is held", () => {
    const save = holding();
    const first = sellInventoryFish(save, STURGEON, 3);
    if (!first.ok) throw new Error("unreachable");
    expect(sellInventoryFish(first.save, STURGEON, 3)).toEqual({ ok: false, reason: "NOT_FOUND", save: first.save });
    expect(sellInventoryFish(save, STURGEON, 4)).toEqual({ ok: false, reason: "INSUFFICIENT_QUANTITY", save });
  });

  it.each([
    [0, "INVALID_QUANTITY"],
    [-2, "INVALID_QUANTITY"],
    [1.2, "INVALID_QUANTITY"],
    [Number.NaN, "INVALID_QUANTITY"]
  ])("refuses quantity %s", (qty, reason) => {
    const save = holding();
    expect(sellInventoryFish(save, STURGEON, qty)).toEqual({ ok: false, reason, save });
  });

  it("refuses unknown fish, fish not held, and inherited object keys", () => {
    const save = holding();
    expect(sellInventoryFish(save, "fish_unicorn", 1)).toEqual({ ok: false, reason: "UNKNOWN_FISH", save });
    expect(sellInventoryFish(save, KOI, 1)).toEqual({ ok: false, reason: "NOT_FOUND", save });
    expect(sellInventoryFish(save, "toString", 1).ok).toBe(false);
    expect(sellInventoryFish(save, "__proto__", 1).ok).toBe(false);
  });
});

describe("sell all", () => {
  it("sells the whole pending list", () => {
    const save = holding();
    const result = sellAllPending(save);
    if (!result.ok) throw new Error("unreachable");
    expect(result.soldCount).toBe(2);
    expect(result.coinsEarned).toBe(550);
    expect(result.save.pendingFish).toEqual([]);
    expect(result.save.fishInventory).toEqual(save.fishInventory);
    expect(result.save.coins).toBe(550);
    expect(result.save.stats.totalFishSold).toBe(2);
    expect(result.save.stats.totalCoinsEarned).toBe(550);
    expect(result.save.catchCounts).toEqual(save.catchCounts);
  });

  it("sells every kept fish", () => {
    const save = { ...holding(), fishInventory: { [STURGEON]: 3, [MOON]: 2 } };
    const result = sellAllInventory(save);
    if (!result.ok) throw new Error("unreachable");
    expect(result.soldCount).toBe(5);
    expect(result.coinsEarned).toBe(3 * 45 + 2 * 100);
    expect(result.save.fishInventory).toEqual({});
    expect(result.save.pendingFish).toEqual(save.pendingFish);
    expect(result.save.stats.totalFishSold).toBe(5);
  });

  it("an empty list is refused, so a second click sells nothing", () => {
    const save = createNewSave(1);
    expect(sellAllPending(save)).toEqual({ ok: false, reason: "NOTHING_TO_SELL", save });
    expect(sellAllInventory(save)).toEqual({ ok: false, reason: "NOTHING_TO_SELL", save });
    const once = sellAllPending(holding());
    if (!once.ok) throw new Error("unreachable");
    expect(sellAllPending(once.save).ok).toBe(false);
  });
});

describe("backpack queries", () => {
  it("values and lists pending and kept fish at sellPrice", () => {
    const save = holding();
    expect(getPendingValue(save)).toBe(550);
    expect(getInventoryValue(save)).toBe(135);
    expect(getPendingEntries(save).map((e) => [e.fish.id, e.unitPrice, e.totalValue])).toEqual([
      [KOI, 50, 50],
      [GUARDIAN, 500, 500]
    ]);
    const entries = getInventoryEntries({ fishInventory: { [GUARDIAN]: 1, [STURGEON]: 3, [KOI]: 0 } });
    expect(entries.map((e) => [e.fish.id, e.quantity, e.totalValue])).toEqual([
      [STURGEON, 3, 135],
      [GUARDIAN, 1, 500]
    ]);
  });

  it("every fish prices at its sellPrice", () => {
    for (const fish of FISH) {
      expect(getInventoryEntries({ fishInventory: { [fish.id]: 2 } })[0].totalValue).toBe(fish.sellPrice * 2);
    }
  });
});
