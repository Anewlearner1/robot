import { GAME_CONFIG } from "../data/gameConfig";
import type { FishRarity, GameSave, OfflineSummary } from "../types/game";
import { applyCatch } from "./catchService";
import { getFishingIntervalSeconds, rollCatch } from "./fishingService";

export interface OfflineCalculation {
  elapsedSeconds: number;
  cappedSeconds: number;
  effectiveCatches: number;
}

/**
 * How many catches an absence is worth: floor(min(elapsed, 4h) / interval x 0.5).
 * Negative elapsed time (clock moved backwards) counts as 0.
 */
export function calculateOfflineCatches(
  lastSettlementAt: number,
  now: number,
  fishingIntervalSeconds: number,
  efficiency = GAME_CONFIG.offline.efficiency
): OfflineCalculation {
  const elapsedSeconds = Math.max(0, Math.floor((now - lastSettlementAt) / 1000));
  const cappedSeconds = Math.min(elapsedSeconds, GAME_CONFIG.offline.maxSeconds);
  const safeInterval = Math.max(1, fishingIntervalSeconds);
  const safeEfficiency = Math.max(0, Math.min(1, efficiency));
  const effectiveCatches = Math.floor((cappedSeconds / safeInterval) * safeEfficiency);
  return { elapsedSeconds, cappedSeconds, effectiveCatches };
}

/**
 * Settle the time since `save.lastOfflineSettlementAt` (PRD §8). Every effective catch is
 * simulated in full (rarity roll with pity/line/unlocks, bait, encyclopedia, auto-sell, rare+
 * to `pendingFish` with source "offline"), so discoveries in the middle of the run unlock
 * rarities for the remaining catches. No minigame: no bonus coins, and the perfect streak neither
 * helps nor changes.
 *
 * The timestamp only ever moves forward: when `now <= lastOfflineSettlementAt` (clock moved
 * backwards, or already settled at this very moment) nothing is earned, the SAME save object is
 * returned and the timestamp is not touched. Otherwise the returned save has
 * `lastOfflineSettlementAt = now`, so settling again at the same `now` yields 0.
 * Show the card when `summary.effectiveCatches > 0`.
 */
export function settleOffline(
  save: GameSave,
  now: number,
  rng: () => number = Math.random
): { save: GameSave; summary: OfflineSummary } {
  const intervalSeconds = getFishingIntervalSeconds(save.equipmentLevels.rod);
  const last = save.lastOfflineSettlementAt;
  const advances = Number.isFinite(now) && now > last;
  const { elapsedSeconds, cappedSeconds, effectiveCatches } = calculateOfflineCatches(
    last,
    advances ? now : last,
    intervalSeconds
  );

  let current = save;
  let soldCount = 0;
  let coinsEarned = 0;
  const newDiscoveries: string[] = [];
  const newlyUnlockedRarities: FishRarity[] = [];
  const pendingTotals = new Map<string, number>();
  const catchesByFish: Record<string, number> = {};

  for (let i = 0; i < effectiveCatches; i++) {
    const fish = rollCatch(current, rng, { perfectStreak: 0 });
    const { save: after, event } = applyCatch(current, fish.id, { source: "offline", now });
    current = after;
    catchesByFish[fish.id] = (catchesByFish[fish.id] ?? 0) + 1;
    if (event.isNewDiscovery) newDiscoveries.push(fish.id);
    newlyUnlockedRarities.push(...event.newlyUnlockedRarities);
    if (event.outcome === "sold") {
      soldCount++;
      coinsEarned += event.coinsEarned;
    } else {
      pendingTotals.set(fish.id, (pendingTotals.get(fish.id) ?? 0) + 1);
    }
  }

  return {
    save: advances ? { ...current, lastOfflineSettlementAt: now } : current,
    summary: {
      fromTimestamp: last,
      toTimestamp: advances ? now : last,
      elapsedSeconds,
      cappedSeconds,
      intervalSeconds,
      effectiveCatches,
      soldCount,
      coinsEarned,
      newDiscoveries,
      newlyUnlockedRarities,
      pendingAdditions: [...pendingTotals].map(([fishId, quantity]) => ({ fishId, quantity })),
      catchesByFish
    }
  };
}
