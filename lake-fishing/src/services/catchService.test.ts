import { describe, expect, it } from "vitest";
import { getFishById } from "../data/fish";
import type { GameSave } from "../types/game";
import {
  applyCatch,
  getInventoryItemPrice,
  getInventoryValue,
  sellAllInventory,
  sellInventoryItem
} from "./catchService";
import { createNewSave, validateSave } from "./saveService";
import { FISH_IDS, saveWithDiscovered } from "./testUtils";

const CARP = "fish_carp"; // common, 8
const CATFISH = "fish_catfish"; // uncommon, 12
const KOI = "fish_koi"; // rare, 50
const MOON = "fish_moonlight_carp"; // epic, 100
const GUARDIAN = "fish_lake_guardian"; // legendary, 500
const NOW = 5_000_000;

const catchFish = (save: GameSave, id: string, perfect = false) => applyCatch(save, id, { perfect, now: NOW });

describe("applyCatch: auto-sell vs inventory", () => {
  it("auto-sells common fish and registers them", () => {
    const { save, event } = catchFish(createNewSave(1), CARP);
    expect(event.outcome).toBe("sold");
    expect(event.coinsEarned).toBe(8);
    expect(event.inventoryItem).toBeNull();
    expect(event.isNewDiscovery).toBe(true);
    expect(save.coins).toBe(8);
    expect(save.inventory).toEqual([]);
    expect(save.discoveredFishIds).toEqual([CARP]);
    expect(save.catchCounts).toEqual({ [CARP]: 1 });
    expect(save.stats).toEqual({ totalCatches: 1, totalFishSold: 1, totalCoinsEarned: 8 });
  });

  it("auto-sells uncommon fish too", () => {
    const { save, event } = catchFish(saveWithDiscovered(5), CATFISH);
    expect(event.outcome).toBe("sold");
    expect(save.coins).toBe(12);
  });

  it.each([KOI, MOON, GUARDIAN])("puts %s into the inventory without paying coins", (id) => {
    const start = saveWithDiscovered(20);
    const { save, event } = catchFish(start, id);
    expect(event.outcome).toBe("inventory");
    expect(event.coinsEarned).toBe(0);
    expect(save.coins).toBe(0);
    expect(save.inventory).toHaveLength(1);
    expect(save.inventory[0]).toMatchObject({ fishId: id, perfect: false, caughtAt: NOW });
    expect(event.inventoryItem).toEqual(save.inventory[0]);
    expect(save.stats.totalFishSold).toBe(0);
    expect(save.stats.totalCatches).toBe(start.stats.totalCatches + 1);
  });

  it("applies the bait multiplier to auto-sales", () => {
    const save = { ...createNewSave(1), equipmentLevels: { rod: 1, line: 1, bait: 6 } };
    expect(catchFish(save, CARP).event.coinsEarned).toBe(10); // 8 * 1.25
  });

  it("marks perfect rare fish and ignores perfect for auto-sold fish", () => {
    const perfect = catchFish(saveWithDiscovered(20), KOI, true);
    expect(perfect.event.perfect).toBe(true);
    expect(perfect.save.inventory[0].perfect).toBe(true);
    const sold = catchFish(createNewSave(1), CARP, true);
    expect(sold.event.perfect).toBe(false);
    expect(sold.event.coinsEarned).toBe(8);
  });

  it("gives every inventory item a unique id, even across sells", () => {
    let save = saveWithDiscovered(20);
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      save = catchFish(save, KOI).save;
      ids.push(save.inventory[save.inventory.length - 1].id);
    }
    save = sellInventoryItem(save, ids[4]).save as GameSave;
    save = catchFish(save, KOI).save;
    ids.push(save.inventory[save.inventory.length - 1].id);
    expect(new Set(ids).size).toBe(6);
  });

  it("does not reuse an id already in the inventory even if the counter is stale", () => {
    let save = catchFish(saveWithDiscovered(20), KOI).save;
    save = { ...save, nextInventoryId: 0 };
    save = catchFish(save, KOI).save;
    expect(new Set(save.inventory.map((i) => i.id)).size).toBe(2);
  });

  it("throws on an unknown fish id", () => {
    expect(() => catchFish(createNewSave(1), "fish_cultrure")).toThrow();
  });
});

describe("applyCatch: discovery and stats", () => {
  it("counts per species and only discovers once", () => {
    let save = createNewSave(1);
    const first = catchFish(save, CARP);
    expect(first.event.speciesCatchCount).toBe(1);
    const second = catchFish(first.save, CARP);
    expect(second.event.isNewDiscovery).toBe(false);
    expect(second.event.speciesCatchCount).toBe(2);
    expect(second.save.discoveredFishIds).toEqual([CARP]);
    expect(second.save.catchCounts[CARP]).toBe(2);
    expect(second.save.stats.totalCatches).toBe(2);
    expect(second.save.stats.totalCoinsEarned).toBe(16);
    save = second.save;
    expect(validateSave(save)).toBe(true);
  });

  it("registers a rare fish in the encyclopedia even though it is kept, and reports unlocks", () => {
    const start = saveWithDiscovered(9); // rare unlocks at 10
    const { save, event } = catchFish(start, FISH_IDS[9]);
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
    catchFish(start, KOI, true);
    catchFish(start, CARP);
    expect(JSON.stringify(start)).toBe(snapshot);
  });

  it("produces saves that pass full validation", () => {
    let save = createNewSave(1);
    for (const id of FISH_IDS) save = catchFish(save, id).save;
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
    let save = saveWithDiscovered(20);
    const e1 = catchFish(save, CARP);
    expect(e1.event.pity).toEqual({ before: 0, after: 1, reset: false });
    const e2 = catchFish(e1.save, KOI);
    expect(e2.event.pity).toEqual({ before: 1, after: 2, reset: false });
    expect(e2.save.pity.consecutiveNonLegendary).toBe(2);
  });

  it("resets to 0 on a legendary", () => {
    let save = { ...saveWithDiscovered(20), pity: { consecutiveNonLegendary: 77 } };
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

describe("selling", () => {
  const withInventory = () => {
    let save = saveWithDiscovered(20);
    save = catchFish(save, KOI).save; // 50
    save = catchFish(save, KOI, true).save; // 75
    save = catchFish(save, GUARDIAN).save; // 500
    return save;
  };

  it("prices: sellPrice x bait x perfect, rounded", () => {
    const save = withInventory();
    expect(save.inventory.map((i) => getInventoryItemPrice(save, i))).toEqual([50, 75, 500]);
    const bait6 = { ...save, equipmentLevels: { rod: 1, line: 1, bait: 6 } };
    expect(bait6.inventory.map((i) => getInventoryItemPrice(bait6, i))).toEqual([63, 94, 625]); // 62.5, 93.75
    expect(getInventoryValue(bait6)).toBe(63 + 94 + 625);
  });

  it("perfect bonus multiplies with bait and rounds once", () => {
    const save = { ...withInventory(), equipmentLevels: { rod: 1, line: 1, bait: 3 } }; // x1.10
    // 50 * 1.1 * 1.5 = 82.5 -> 83 ; 50 * 1.1 = 55
    expect(getInventoryItemPrice(save, save.inventory[1])).toBe(83);
    expect(getInventoryItemPrice(save, save.inventory[0])).toBe(55);
  });

  it("sells one item", () => {
    const save = withInventory();
    const target = save.inventory[1];
    const result = sellInventoryItem(save, target.id);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.coinsEarned).toBe(75);
    expect(result.save.coins).toBe(75);
    expect(result.save.inventory.map((i) => i.id)).toEqual([save.inventory[0].id, save.inventory[2].id]);
    expect(result.save.stats.totalFishSold).toBe(1);
    expect(result.save.stats.totalCoinsEarned).toBe(75);
    expect(save.inventory).toHaveLength(3); // input untouched
    expect(validateSave(result.save)).toBe(true);
  });

  it("selling an unknown or already-sold item changes nothing", () => {
    const save = withInventory();
    const missing = sellInventoryItem(save, "nope");
    expect(missing).toEqual({ ok: false, reason: "NOT_FOUND", save });
    const sold = sellInventoryItem(save, save.inventory[0].id);
    if (!sold.ok) throw new Error("unreachable");
    expect(sellInventoryItem(sold.save, save.inventory[0].id).ok).toBe(false);
  });

  it("sells everything", () => {
    const save = withInventory();
    const result = sellAllInventory(save);
    expect(result.soldCount).toBe(3);
    expect(result.coinsEarned).toBe(625);
    expect(result.save.coins).toBe(625);
    expect(result.save.inventory).toEqual([]);
    expect(result.save.stats.totalFishSold).toBe(3);
    expect(result.save.stats.totalCoinsEarned).toBe(625);
    expect(result.save.catchCounts).toEqual(save.catchCounts);
  });

  it("sell all on an empty backpack is a no-op", () => {
    const save = createNewSave(1);
    expect(sellAllInventory(save)).toEqual({ save, coinsEarned: 0, soldCount: 0 });
  });

  it("uses the bait level at sale time, not at catch time", () => {
    const save = catchFish(saveWithDiscovered(20), getFishById(KOI)!.id).save;
    const upgraded = { ...save, equipmentLevels: { ...save.equipmentLevels, bait: 6 } };
    const result = sellInventoryItem(upgraded, upgraded.inventory[0].id);
    if (!result.ok) throw new Error("unreachable");
    expect(result.coinsEarned).toBe(63);
  });
});
