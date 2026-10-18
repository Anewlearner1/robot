import { FISH, isKnownFishId } from "../data/fish";
import { GAME_CONFIG, RARITY_ORDER } from "../data/gameConfig";
import type { FishDefinition, FishRarity, GameSave } from "../types/game";

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

/** Collection progress: distinct known fish discovered, total species, whole percent (rounded down). */
export function getCollectionProgress(discoveredFishIds: readonly string[]): {
  discovered: number;
  total: number;
  percent: number;
} {
  const discovered = countDiscoveredFish(discoveredFishIds);
  const total = FISH.length;
  return { discovered, total, percent: total === 0 ? 0 : Math.floor((discovered / total) * 100) };
}

/** Distinct species needed to unlock a rarity (0 for common). */
export function getRarityUnlockThreshold(rarity: FishRarity): number {
  return GAME_CONFIG.collectionUnlocks[rarity];
}

/**
 * The next rarity still locked and how many MORE distinct species must be discovered to unlock
 * it (`needed` >= 1); null once every rarity is unlocked. The UI should not recompute this.
 */
export function getNextUnlock(
  save: Pick<GameSave, "discoveredFishIds">
): { rarity: FishRarity; needed: number } | null {
  const count = countDiscoveredFish(save.discoveredFishIds);
  for (const rarity of RARITY_ORDER) {
    const needed = GAME_CONFIG.collectionUnlocks[rarity] - count;
    if (needed > 0) return { rarity, needed };
  }
  return null;
}

export interface EncyclopediaEntry {
  fish: FishDefinition;
  discovered: boolean;
  /** Lifetime catches of this species (0 when undiscovered). */
  caughtCount: number;
}

/** Rarity filter for the encyclopedia: a rarity, or "all". */
export type EncyclopediaFilter = FishRarity | "all";

/**
 * The 25 slots in catalogue order, with discovery state and catch counts. Pass a rarity (or
 * `{ rarity }`) to list only that rarity; "all" / nothing lists every species.
 */
export function getEncyclopediaEntries(
  save: Pick<GameSave, "discoveredFishIds" | "catchCounts">,
  filter: EncyclopediaFilter | { rarity?: EncyclopediaFilter } = "all"
): EncyclopediaEntry[] {
  const rarity = typeof filter === "string" ? filter : filter.rarity ?? "all";
  const discovered = new Set(getKnownDiscoveredIds(save.discoveredFishIds));
  return FISH.filter((fish) => rarity === "all" || fish.rarity === rarity).map((fish) => ({
    fish,
    discovered: discovered.has(fish.id),
    caughtCount: discovered.has(fish.id) ? save.catchCounts[fish.id] ?? 0 : 0
  }));
}
