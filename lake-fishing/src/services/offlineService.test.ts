import { describe, expect, it } from "vitest";
import { GAME_CONFIG } from "../data/gameConfig";
import { calculateOfflineCatches, settleOffline } from "./offlineService";
import { validateSave } from "./saveService";
import { saveWithDiscovered, seededRng, sequenceRng } from "./testUtils";

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

  it("30 minutes at rod level 1 -> 10 catches", () => {
    const result = calculateOfflineCatches(start, start + 30 * 60 * 1000, 90);
    expect(result.elapsedSeconds).toBe(1800);
    expect(result.effectiveCatches).toBe(10);
  });

  it("floors partial catches at 0.5 efficiency", () => {
    // 179 s / 90 * 0.5 = 0.99 -> 0 ; 180 s -> 1
    expect(calculateOfflineCatches(0, 179_000, 90).effectiveCatches).toBe(0);
    expect(calculateOfflineCatches(0, 180_000, 90).effectiveCatches).toBe(1);
  });
});

describe("settleOffline", () => {
  const T0 = 10_000_000;
  const base = { ...saveWithDiscovered(0, T0), lastOfflineSettlementAt: T0 };

  it("moves lastOfflineSettlementAt and nothing else when nothing was earned", () => {
    const { save, summary } = settleOffline(base, T0 + 60_000, seededRng(1));
    expect(summary.effectiveCatches).toBe(0);
    expect(save).toEqual({ ...base, lastOfflineSettlementAt: T0 + 60_000 });
  });

  it("PRD §14: 30 minutes at rod level 1 -> 10 catches", () => {
    const { save, summary } = settleOffline(base, T0 + 30 * 60 * 1000, seededRng(5));
    expect(summary).toMatchObject({ effectiveCatches: 10, elapsedSeconds: 1800, cappedSeconds: 1800, intervalSeconds: 90 });
    expect(save.stats.totalCatches).toBe(10);
    expect(Object.values(summary.catchesByFish).reduce((a, b) => a + b, 0)).toBe(10);
    expect(validateSave(save)).toBe(true);
  });

  it("PRD §14: 4 hours at rod level 1 -> 80 catches", () => {
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
    expect(save.lastOfflineSettlementAt).toBe(T0 + 4 * HOUR);
    expect(validateSave(save)).toBe(true);
  });

  it("PRD §14: 8 hours still counts only 4 hours -> 80 catches", () => {
    const { save, summary } = settleOffline(base, T0 + 8 * HOUR, seededRng(5));
    expect(summary).toMatchObject({ effectiveCatches: 80, elapsedSeconds: 28800, cappedSeconds: 14400 });
    expect(save.stats.totalCatches).toBe(80);
    expect(save.lastOfflineSettlementAt).toBe(T0 + 8 * HOUR);
  });

  it("caps at four hours no matter how long the absence", () => {
    const four = settleOffline(base, T0 + 4 * HOUR, seededRng(5));
    const week = settleOffline(base, T0 + 7 * 24 * HOUR, seededRng(5));
    expect(week.summary.effectiveCatches).toBe(80);
    expect(week.summary.elapsedSeconds).toBe(7 * 24 * 3600);
    expect(week.summary.cappedSeconds).toBe(GAME_CONFIG.offline.maxSeconds);
    expect(week.save.coins).toBe(four.save.coins);
    expect(week.save.lastOfflineSettlementAt).toBe(T0 + 7 * 24 * HOUR);
  });

  it("PRD §14: a clock moved backwards earns nothing and the timestamp is NOT moved back", () => {
    const rich = { ...saveWithDiscovered(12, T0), lastOfflineSettlementAt: T0, coins: 77 };
    const { save, summary } = settleOffline(rich, T0 - 5 * HOUR, seededRng(5));
    expect(summary.elapsedSeconds).toBe(0);
    expect(summary.effectiveCatches).toBe(0);
    expect(save).toBe(rich); // untouched, same object
    expect(save.coins).toBe(77);
    expect(save.stats.totalCatches).toBe(rich.stats.totalCatches);
    expect(save.lastOfflineSettlementAt).toBe(T0);
    // ...and a later correct clock still pays out from the original timestamp.
    const later = settleOffline(save, T0 + 30 * 60 * 1000, seededRng(5));
    expect(later.summary.effectiveCatches).toBe(10);
  });

  it("non-finite time is ignored the same way", () => {
    for (const bad of [Number.NaN, -Infinity]) {
      const { save, summary } = settleOffline(base, bad, seededRng(1));
      expect(summary.effectiveCatches).toBe(0);
      expect(save.lastOfflineSettlementAt).toBe(T0);
    }
  });

  it("PRD §14: settling twice at the same now pays nothing the second time", () => {
    const start = { ...saveWithDiscovered(12, T0), lastOfflineSettlementAt: T0 };
    const now = T0 + 4 * HOUR;
    const first = settleOffline(start, now, seededRng(9));
    expect(first.summary.effectiveCatches).toBe(80);
    const second = settleOffline(first.save, now, seededRng(9));
    expect(second.summary.effectiveCatches).toBe(0);
    expect(second.summary.coinsEarned).toBe(0);
    expect(second.summary.pendingAdditions).toEqual([]);
    expect(second.save.coins).toBe(first.save.coins);
    expect(second.save).toEqual(first.save);
    expect(second.save.lastOfflineSettlementAt).toBe(now);
    // a third call with a slightly earlier clock does not pay or move the timestamp either
    const third = settleOffline(second.save, now - 1000, seededRng(9));
    expect(third.save).toEqual(first.save);
  });

  it("uses the rod level for the interval (rod 6: 54 s -> 133 catches)", () => {
    const rod6 = { ...base, equipmentLevels: { rod: 6, line: 1, bait: 1 } };
    const { summary } = settleOffline(rod6, T0 + 4 * HOUR, seededRng(5));
    expect(summary.intervalSeconds).toBe(54);
    expect(summary.effectiveCatches).toBe(133);
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

  it("summary matches the save: coins, discoveries, pending fish", () => {
    const start = { ...saveWithDiscovered(12, T0), lastOfflineSettlementAt: T0 };
    const { save, summary } = settleOffline(start, T0 + 4 * HOUR, seededRng(77));
    expect(save.coins - start.coins).toBe(summary.coinsEarned);
    expect(save.stats.totalCoinsEarned - start.stats.totalCoinsEarned).toBe(summary.coinsEarned);
    expect(save.discoveredFishIds.slice(start.discoveredFishIds.length)).toEqual(summary.newDiscoveries);
    const pendingTotal = summary.pendingAdditions.reduce((sum, entry) => sum + entry.quantity, 0);
    expect(save.pendingFish.reduce((sum, row) => sum + row.quantity, 0)).toBe(pendingTotal);
    expect(summary.soldCount + pendingTotal).toBe(summary.effectiveCatches);
    expect(save.stats.totalFishSold).toBe(start.stats.totalFishSold + summary.soldCount);
  });

  it("sends rare+ fish to pendingFish with source 'offline' (merged per fish), sells the rest", () => {
    const rich = { ...saveWithDiscovered(20, T0), lastOfflineSettlementAt: T0, equipmentLevels: { rod: 6, line: 6, bait: 1 } };
    const { save, summary } = settleOffline(rich, T0 + 4 * HOUR, seededRng(3));
    expect(save.pendingFish.length).toBeGreaterThan(0);
    expect(save.fishInventory).toEqual({});
    const rarePlus = ["fish_golden_carp", "fish_koi", "fish_sturgeon", "fish_eel", "fish_rainbow_trout", "fish_moonlight_carp", "fish_starry_trout", "fish_jade_dragonfish", "fish_lake_guardian", "fish_moonshadow"];
    for (const row of save.pendingFish) {
      expect(rarePlus).toContain(row.fishId);
      expect(row.source).toBe("offline");
      expect(row.caughtAt).toBe(T0 + 4 * HOUR);
      expect(row.quantity).toBeGreaterThan(0);
    }
    // One row per species (same fish + same source merge).
    expect(new Set(save.pendingFish.map((row) => row.fishId)).size).toBe(save.pendingFish.length);
    expect(summary.pendingAdditions).toEqual(save.pendingFish.map((row) => ({ fishId: row.fishId, quantity: row.quantity })));
    expect(validateSave(save)).toBe(true);
  });

  it("offline ignores the perfect streak and pays no minigame bonus", () => {
    const streaky = { ...base, minigame: { perfectStreak: 7 } };
    const a = settleOffline(streaky, T0 + 4 * HOUR, seededRng(21));
    const b = settleOffline(base, T0 + 4 * HOUR, seededRng(21));
    expect(a.save.minigame.perfectStreak).toBe(7);
    expect({ ...a.save, minigame: base.minigame }).toEqual(b.save);
  });

  it("unlocks new rarities mid-run and reports them, counting pity only afterwards", () => {
    const { save, summary } = settleOffline(base, T0 + 4 * HOUR, seededRng(11));
    expect(summary.newDiscoveries.length).toBeGreaterThan(5);
    expect(summary.newlyUnlockedRarities).toContain("uncommon");
    expect(save.pity.consecutiveNonLegendary).toBeLessThanOrEqual(save.stats.totalCatches);
    if (save.discoveredFishIds.length < 20) expect(save.pity.consecutiveNonLegendary).toBe(0);
  });

  it("sells at plain sellPrice whatever the bait level", () => {
    const withBait = { ...base, equipmentLevels: { rod: 1, line: 1, bait: 6 } };
    const a = settleOffline(base, T0 + 30 * 60 * 1000, sequenceRng([0, 0]));
    const b = settleOffline(withBait, T0 + 30 * 60 * 1000, sequenceRng([0, 0]));
    // rng 0 -> common, first fish: 10 x fish_crucian_carp (5 coins), bait only changes the pick weight
    expect(a.summary.coinsEarned).toBe(50);
    expect(b.summary.coinsEarned).toBe(50);
  });
});
