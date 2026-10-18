import { describe, expect, it } from "vitest";
import { GAME_CONFIG } from "../data/gameConfig";
import { calculateOfflineCatches, settleOffline } from "./offlineService";
import { validateSave } from "./saveService";
import { saveWithDiscovered, seededRng } from "./testUtils";

const HOUR = 60 * 60 * 1000;

describe("offline calculation", () => {
  const start = 1_000_000;

  it("calculates 80 effective catches for 4 hours at 90 seconds and 50%", () => {
    const result = calculateOfflineCatches(start, start + 4 * HOUR, 90);
    expect(result.cappedSeconds).toBe(14400);
    expect(result.effectiveCatches).toBe(80);
  });

  it("caps offline time at four hours", () => {
    const result = calculateOfflineCatches(start, start + 8 * HOUR, 90);
    expect(result.cappedSeconds).toBe(14400);
    expect(result.elapsedSeconds).toBe(28800);
    expect(result.effectiveCatches).toBe(80);
  });

  it("does not produce negative catches if system time moves backwards", () => {
    const result = calculateOfflineCatches(start, start - 60_000, 90);
    expect(result.elapsedSeconds).toBe(0);
    expect(result.effectiveCatches).toBe(0);
  });

  it("floors partial catches at 0.5 efficiency", () => {
    // 179 s / 90 * 0.5 = 0.99 -> 0 ; 180 s -> 1
    expect(calculateOfflineCatches(0, 179_000, 90).effectiveCatches).toBe(0);
    expect(calculateOfflineCatches(0, 180_000, 90).effectiveCatches).toBe(1);
  });
});

describe("settleOffline", () => {
  const T0 = 10_000_000;
  const base = { ...saveWithDiscovered(0, T0), lastActiveAt: T0 };

  it("returns the same data with lastActiveAt moved when nothing was earned", () => {
    const { save, summary } = settleOffline(base, T0 + 60_000, seededRng(1));
    expect(summary.effectiveCatches).toBe(0);
    expect(save).toEqual({ ...base, lastActiveAt: T0 + 60_000 });
  });

  it("simulates 80 catches after 4 hours at rod level 1", () => {
    const { save, summary } = settleOffline(base, T0 + 4 * HOUR, seededRng(5));
    expect(summary).toMatchObject({
      effectiveCatches: 80,
      elapsedSeconds: 14400,
      cappedSeconds: 14400,
      intervalSeconds: 90,
      fromTimestamp: T0,
      toTimestamp: T0 + 4 * HOUR
    });
    expect(save.stats.totalCatches).toBe(80);
    expect(Object.values(summary.catchesByFish).reduce((a, b) => a + b, 0)).toBe(80);
    expect(save.lastActiveAt).toBe(T0 + 4 * HOUR);
    expect(validateSave(save)).toBe(true);
  });

  it("caps at four hours no matter how long the absence", () => {
    const four = settleOffline(base, T0 + 4 * HOUR, seededRng(5));
    const week = settleOffline(base, T0 + 7 * 24 * HOUR, seededRng(5));
    expect(week.summary.effectiveCatches).toBe(80);
    expect(week.summary.elapsedSeconds).toBe(7 * 24 * 3600);
    expect(week.summary.cappedSeconds).toBe(GAME_CONFIG.offline.maxSeconds);
    expect(week.save.coins).toBe(four.save.coins);
    expect(week.save.lastActiveAt).toBe(T0 + 7 * 24 * HOUR);
  });

  it("uses the rod level for the interval (rod 6: 54 s -> 133 catches)", () => {
    const rod6 = { ...base, equipmentLevels: { rod: 6, line: 1, bait: 1 } };
    const { summary } = settleOffline(rod6, T0 + 4 * HOUR, seededRng(5));
    expect(summary.intervalSeconds).toBe(54);
    expect(summary.effectiveCatches).toBe(133);
  });

  it("treats a clock that went backwards as zero elapsed time", () => {
    const { save, summary } = settleOffline(base, T0 - 5 * HOUR, seededRng(5));
    expect(summary.elapsedSeconds).toBe(0);
    expect(summary.effectiveCatches).toBe(0);
    expect(save.coins).toBe(0);
    expect(save.stats.totalCatches).toBe(0);
    expect(save.lastActiveAt).toBe(T0 - 5 * HOUR);
  });

  it("is deterministic for the same seed and differs for another", () => {
    const a = settleOffline(base, T0 + 4 * HOUR, seededRng(42));
    const b = settleOffline(base, T0 + 4 * HOUR, seededRng(42));
    const c = settleOffline(base, T0 + 4 * HOUR, seededRng(43));
    expect(a).toEqual(b);
    expect(a.save.catchCounts).not.toEqual(c.save.catchCounts);
  });

  it("does not mutate the input save", () => {
    const snapshot = JSON.stringify(base);
    settleOffline(base, T0 + 4 * HOUR, seededRng(1));
    expect(JSON.stringify(base)).toBe(snapshot);
  });

  it("summary matches the save: coins, discoveries, inventory", () => {
    const start = saveWithDiscovered(12, T0);
    const { save, summary } = settleOffline({ ...start, lastActiveAt: T0 }, T0 + 4 * HOUR, seededRng(77));
    expect(save.coins - start.coins).toBe(summary.coinsEarned);
    expect(save.stats.totalCoinsEarned - start.stats.totalCoinsEarned).toBe(summary.coinsEarned);
    expect(save.discoveredFishIds.slice(start.discoveredFishIds.length)).toEqual(summary.newDiscoveries);
    expect(save.inventory.slice(start.inventory.length)).toEqual(summary.inventoryAdditions);
    expect(summary.soldCount + summary.inventoryAdditions.length).toBe(summary.effectiveCatches);
    expect(summary.inventoryAdditions.every((item) => !item.perfect && item.caughtAt === T0 + 4 * HOUR)).toBe(true);
    expect(save.stats.totalFishSold).toBe(summary.soldCount);
  });

  it("sells common/uncommon, keeps rare+, and registers discoveries even with a big run", () => {
    const rich = { ...saveWithDiscovered(20, T0), lastActiveAt: T0, equipmentLevels: { rod: 6, line: 6, bait: 1 } };
    const { save, summary } = settleOffline(rich, T0 + 4 * HOUR, seededRng(3));
    expect(save.inventory.length).toBeGreaterThan(0);
    expect(summary.inventoryAdditions).toHaveLength(save.inventory.length);
    for (const item of save.inventory) {
      expect(["fish_golden_carp", "fish_koi", "fish_sturgeon", "fish_eel", "fish_rainbow_trout", "fish_moonlight_carp", "fish_starry_trout", "fish_jade_dragonfish", "fish_lake_guardian", "fish_moonshadow"]).toContain(item.fishId);
    }
    expect(validateSave(save)).toBe(true);
  });

  it("unlocks new rarities mid-run and reports them, counting pity only afterwards", () => {
    const { save, summary } = settleOffline(base, T0 + 4 * HOUR, seededRng(11));
    expect(summary.newDiscoveries.length).toBeGreaterThan(5);
    expect(summary.newlyUnlockedRarities).toContain("uncommon");
    // Pity only counts after legendary unlocks (20 species), so it can't exceed catches since then.
    expect(save.pity.consecutiveNonLegendary).toBeLessThanOrEqual(save.stats.totalCatches);
    if (save.discoveredFishIds.length < 20) expect(save.pity.consecutiveNonLegendary).toBe(0);
  });

  it("applies the bait multiplier to offline sales", () => {
    const withBait = { ...base, equipmentLevels: { rod: 1, line: 1, bait: 6 } };
    const a = settleOffline(base, T0 + 4 * HOUR, seededRng(8));
    const b = settleOffline(withBait, T0 + 4 * HOUR, seededRng(8));
    expect(b.summary.coinsEarned).toBeGreaterThan(a.summary.coinsEarned);
  });
});
