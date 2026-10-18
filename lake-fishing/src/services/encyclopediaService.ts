import { FISH, isKnownFishId } from "../data/fish";
import type { FishDefinition, GameSave } from "../types/game";

/**
 * The one way to read a discovered-ids list: unique ids that belong to a real fish,
 * in original order. Unknown ids (stale or corrupt data) are ignored.
 */
export function getKnownDiscoveredIds(discoveredFishIds: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const id of discoveredFishIds) {
    if (isKnownFishId(id)) seen.add(id);
  }
  return [...seen];
}

/** Number of distinct known fish discovered; this is what unlocks rarities. */
export function countDiscoveredFish(discoveredFishIds: readonly string[]): number {
  return getKnownDiscoveredIds(discoveredFishIds).length;
}

export function getCollectionProgress(discoveredFishIds: readonly string[]): {
  discoveredCount: number;
  totalCount: number;
  percentage: number;
} {
  const discoveredCount = countDiscoveredFish(discoveredFishIds);
  const totalCount = FISH.length;
  return {
    discoveredCount,
    totalCount,
    percentage: totalCount === 0 ? 0 : Math.floor((discoveredCount / totalCount) * 100)
  };
}

export interface EncyclopediaEntry {
  fish: FishDefinition;
  discovered: boolean;
  /** Lifetime catches of this species (0 when undiscovered). */
  caughtCount: number;
}

/** All 25 slots in catalogue order, with discovery state and catch counts. */
export function getEncyclopediaEntries(
  save: Pick<GameSave, "discoveredFishIds" | "catchCounts">
): EncyclopediaEntry[] {
  const discovered = new Set(getKnownDiscoveredIds(save.discoveredFishIds));
  return FISH.map((fish) => ({
    fish,
    discovered: discovered.has(fish.id),
    caughtCount: discovered.has(fish.id) ? save.catchCounts[fish.id] ?? 0 : 0
  }));
}
