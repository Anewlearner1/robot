import { GAME_CONFIG } from "../data/gameConfig";
import type { FishRarity, GameSave, InventoryItem, OfflineSummary } from "../types/game";
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
 * Settle the time since `save.lastActiveAt`. Every effective catch is simulated in full
 * (rarity roll with pity/line/unlocks, encyclopedia, auto-sell or inventory), so discoveries
 * in the middle of the run unlock rarities for the remaining catches. No minigame, no perfects.
 * The returned save has `lastActiveAt = now`. Show the dialog when `summary.effectiveCatches > 0`.
 */
export function settleOffline(
  save: GameSave,
  now: number,
  rng: () => number = Math.random
): { save: GameSave; summary: OfflineSummary } {
  const intervalSeconds = getFishingIntervalSeconds(save.equipmentLevels.rod);
  const { elapsedSeconds, cappedSeconds, effectiveCatches } = calculateOfflineCatches(
    save.lastActiveAt,
    now,
    intervalSeconds
  );

  let current = save;
  let soldCount = 0;
  let coinsEarned = 0;
  const newDiscoveries: string[] = [];
  const newlyUnlockedRarities: FishRarity[] = [];
  const inventoryAdditions: InventoryItem[] = [];
  const catchesByFish: Record<string, number> = {};

  for (let i = 0; i < effectiveCatches; i++) {
    const fish = rollCatch(current, rng);
    const { save: after, event } = applyCatch(current, fish.id, { now });
    current = after;
    catchesByFish[fish.id] = (catchesByFish[fish.id] ?? 0) + 1;
    if (event.isNewDiscovery) newDiscoveries.push(fish.id);
    newlyUnlockedRarities.push(...event.newlyUnlockedRarities);
    if (event.outcome === "sold") {
      soldCount++;
      coinsEarned += event.coinsEarned;
    } else if (event.inventoryItem) {
      inventoryAdditions.push(event.inventoryItem);
    }
  }

  return {
    save: { ...current, lastActiveAt: now },
    summary: {
      fromTimestamp: save.lastActiveAt,
      toTimestamp: now,
      elapsedSeconds,
      cappedSeconds,
      intervalSeconds,
      effectiveCatches,
      soldCount,
      coinsEarned,
      newDiscoveries,
      newlyUnlockedRarities,
      inventoryAdditions,
      catchesByFish
    }
  };
}
