import { describe, expect, it, vi } from "vitest";
import { applyCatch } from "./catchService";
import { upgradeEquipment } from "./economyService";
import { getLegendaryChance, getSaveRarityWeights } from "./fishingService";
import { settleOffline } from "./offlineService";
import {
  createNewSave,
  exportSaveJson,
  loadFromLocalStorage,
  parseImportedSave,
  SAVE_KEY,
  saveToLocalStorage
} from "./saveService";
import { saveWithDiscovered, sequenceRng } from "./testUtils";

const HOUR = 60 * 60 * 1000;
const PITY = 137; // inside the 100-149 band (1.0%)

/** Legendary is unlocked (20 species) and the player is mid-streak at PITY misses. */
const pitySave = () => ({
  ...saveWithDiscovered(20, 1_000),
  pity: { consecutiveNonLegendary: PITY },
  coins: 5_000
});

function mockStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: vi.fn((key: string) => data.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => void data.set(key, value))
  };
}

describe("legendary pity survives (PRD §4)", () => {
  it("an equipment upgrade of every kind", () => {
    let save = pitySave();
    const weightBefore = getSaveRarityWeights(save).legendary;
    for (const type of ["rod", "line", "bait"] as const) {
      const upgraded = upgradeEquipment(save, type);
      expect(upgraded.result.success).toBe(true);
      save = upgraded.save;
      expect(save.pity.consecutiveNonLegendary).toBe(PITY);
    }
    expect(save.equipmentLevels).toEqual({ rod: 2, line: 2, bait: 2 });
    // The band chance is still the 100-149 one (a better line only reshuffles the others).
    expect(getLegendaryChance(save.pity.consecutiveNonLegendary)).toBe(0.01);
    expect(getSaveRarityWeights(save).legendary).toBeGreaterThan(weightBefore); // line Lv2 shifts weight to rarer tiers
  });

  it("an export / import round trip", () => {
    const save = pitySave();
    const imported = parseImportedSave(exportSaveJson(save));
    expect(imported.pity.consecutiveNonLegendary).toBe(PITY);
    expect(imported).toEqual(save);
    expect(getSaveRarityWeights(imported)).toEqual(getSaveRarityWeights(save));
  });

  it("a localStorage save and load", () => {
    const storage = mockStorage();
    const written = saveToLocalStorage(pitySave(), storage, 2_000);
    expect(written.ok).toBe(true);
    const loaded = loadFromLocalStorage(storage);
    expect(loaded.status).toBe("loaded");
    if (loaded.status !== "loaded") throw new Error("unreachable");
    expect(loaded.save.pity.consecutiveNonLegendary).toBe(PITY);
    expect(storage.data.has(SAVE_KEY)).toBe(true);
    expect(getSaveRarityWeights(loaded.save).legendary).toBeCloseTo(getSaveRarityWeights(pitySave()).legendary, 12);
  });

  it("offline settlement: the counter keeps counting from where it was", () => {
    // rng 0 -> always the first common fish, never a legendary: 80 catches in 4 hours.
    const { save, summary } = settleOffline({ ...pitySave(), lastOfflineSettlementAt: 1_000 }, 1_000 + 4 * HOUR, sequenceRng([0, 0]));
    expect(summary.effectiveCatches).toBe(80);
    expect(save.pity.consecutiveNonLegendary).toBe(PITY + 80);
  });

  it("offline settlement: a legendary resets it, and later catches count again", () => {
    // 3 catches (common x1, legendary, common x1) in 9 minutes: 540 s / 90 * 0.5 = 3
    const rolls = [0, 0, 0.9999, 0.99, 0, 0]; // [rarity, fish] x 3: common, legendary, common
    const { save, summary } = settleOffline({ ...pitySave(), lastOfflineSettlementAt: 1_000 }, 1_000 + 9 * 60 * 1000, sequenceRng(rolls));
    expect(summary.effectiveCatches).toBe(3);
    expect(Object.keys(summary.catchesByFish)).toContain("fish_moonshadow");
    expect(save.pity.consecutiveNonLegendary).toBe(1);
  });

  it("the whole chain at once: upgrade -> offline -> save -> load -> export -> import -> catch", () => {
    let save = upgradeEquipment(pitySave(), "rod").save;
    save = settleOffline({ ...save, lastOfflineSettlementAt: 1_000 }, 1_000 + 30 * 60 * 1000, sequenceRng([0, 0])).save;
    // rod Lv2 = 83 s -> floor(1800 / 83 * 0.5) = 10 catches, none of them legendary (rng 0)
    const catches = save.stats.totalCatches - pitySave().stats.totalCatches;
    expect(save.pity.consecutiveNonLegendary).toBe(PITY + catches);
    expect(catches).toBe(10);
    const storage = mockStorage();
    const written = saveToLocalStorage(save, storage, 9_999);
    if (!written.ok) throw new Error("unreachable");
    const loaded = loadFromLocalStorage(storage);
    if (loaded.status !== "loaded") throw new Error("unreachable");
    const imported = parseImportedSave(exportSaveJson(loaded.save));
    expect(imported.pity.consecutiveNonLegendary).toBe(PITY + catches);
    const next = applyCatch(imported, "fish_carp", { source: "active", now: 10_000 }).save;
    expect(next.pity.consecutiveNonLegendary).toBe(PITY + catches + 1);
    const reset = applyCatch(next, "fish_lake_guardian", { source: "active", now: 10_001 }).save;
    expect(reset.pity.consecutiveNonLegendary).toBe(0);
  });

  it("is not counted while legendary is locked, across the same round trips", () => {
    const locked = { ...createNewSave(1), pity: { consecutiveNonLegendary: 0 } };
    const after = settleOffline({ ...locked, lastOfflineSettlementAt: 1 }, 1 + 4 * HOUR, sequenceRng([0, 0])).save;
    // rng 0 keeps hitting the first common fish: fewer than 20 species, so no pity counting
    expect(after.discoveredFishIds.length).toBeLessThan(20);
    expect(after.pity.consecutiveNonLegendary).toBe(0);
    expect(parseImportedSave(exportSaveJson(after)).pity.consecutiveNonLegendary).toBe(0);
  });
});
