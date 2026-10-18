import { getEquipmentEffect } from "../data/equipment";
import { FISH } from "../data/fish";
import { GAME_CONFIG } from "../data/gameConfig";
import type { FishDefinition, FishRarity, GameSave } from "../types/game";
import { countDiscoveredFish } from "./encyclopediaService";

export const RARITY_ORDER: readonly FishRarity[] = ["common", "uncommon", "rare", "epic", "legendary"];

/** Rarity weights as percentages. Locked rarities are 0; the rest add up to 100. */
export type RarityWeights = Record<FishRarity, number>;

const emptyWeights = (): RarityWeights => ({ common: 0, uncommon: 0, rare: 0, epic: 0, legendary: 0 });

/** Rarities available to the player, based on how many distinct fish were discovered. */
export function getUnlockedRarities(discoveredFishIds: readonly string[]): FishRarity[] {
  const collectionCount = countDiscoveredFish(discoveredFishIds);
  return RARITY_ORDER.filter((rarity) => collectionCount >= GAME_CONFIG.collectionUnlocks[rarity]);
}

/** Base weights restricted to unlocked rarities and rescaled to total 100. */
export function getBaseRarityWeights(unlocked: readonly FishRarity[]): RarityWeights {
  const weights = emptyWeights();
  const total = unlocked.reduce((sum, rarity) => sum + GAME_CONFIG.rarityWeights[rarity], 0);
  if (total <= 0) return weights;
  for (const rarity of unlocked) {
    weights[rarity] = (GAME_CONFIG.rarityWeights[rarity] / total) * 100;
  }
  return weights;
}

/**
 * Line effect: move `effect` (e.g. 0.10) of the total weight out of "common" and distribute it
 * over the unlocked rarities above common in proportion to their current weights, so rarer
 * tiers stay relatively rarer. The total is unchanged. If nothing above common is unlocked, or
 * common has less than that to give, only what is possible moves.
 */
export function applyLineEffect(
  weights: RarityWeights,
  unlocked: readonly FishRarity[],
  effect: number
): RarityWeights {
  const result = { ...weights };
  const targets = unlocked.filter((rarity) => rarity !== "common");
  if (!(effect > 0) || targets.length === 0 || !unlocked.includes("common")) return result;
  const total = RARITY_ORDER.reduce((sum, rarity) => sum + weights[rarity], 0);
  const targetsTotal = targets.reduce((sum, rarity) => sum + weights[rarity], 0);
  if (targetsTotal <= 0) return result;
  const shift = Math.min(weights.common, effect * total);
  result.common -= shift;
  for (const rarity of targets) result[rarity] += shift * (weights[rarity] / targetsTotal);
  return result;
}

/** Legendary chance (0..1) for a pity counter, from the gameConfig bands. */
export function getLegendaryChance(pityCount: number): number {
  const count = Number.isFinite(pityCount) ? Math.max(0, Math.floor(pityCount)) : 0;
  const band = GAME_CONFIG.legendaryPity.find(
    (entry) => count >= entry.min && (entry.max === null || count <= entry.max)
  );
  return band?.chance ?? GAME_CONFIG.rarityWeights.legendary / 100;
}

/**
 * Pity: raise legendary by (pity chance - base chance) and take exactly that much from the
 * other unlocked rarities in proportion to their current weight. The total is unchanged.
 * Does nothing while legendary is locked.
 */
export function applyLegendaryPity(
  weights: RarityWeights,
  unlocked: readonly FishRarity[],
  pityCount: number
): RarityWeights {
  const result = { ...weights };
  if (!unlocked.includes("legendary")) return result;
  const others = unlocked.filter((rarity) => rarity !== "legendary");
  const othersTotal = others.reduce((sum, rarity) => sum + weights[rarity], 0);
  const wanted = Math.max(0, getLegendaryChance(pityCount) * 100 - GAME_CONFIG.rarityWeights.legendary);
  const extra = Math.min(wanted, othersTotal);
  if (extra <= 0 || othersTotal <= 0) return result;
  const factor = (othersTotal - extra) / othersTotal;
  for (const rarity of others) result[rarity] = weights[rarity] * factor;
  result.legendary += extra;
  return result;
}

/**
 * Final rarity weights (percent, total 100 over unlocked rarities, 0 for locked ones):
 * base weights -> line effect -> legendary pity.
 * @param lineEffect raw line effectValue (0..0.10); see `getEquipmentEffect("line", level)`.
 */
export function getRarityWeights(
  discoveredFishIds: readonly string[],
  pityCount = 0,
  lineEffect = 0
): RarityWeights {
  const unlocked = getUnlockedRarities(discoveredFishIds);
  const base = getBaseRarityWeights(unlocked);
  const lined = applyLineEffect(base, unlocked, lineEffect);
  return applyLegendaryPity(lined, unlocked, pityCount);
}

/** `getRarityWeights` using a save's discoveries, pity counter and line level. */
export function getSaveRarityWeights(
  save: Pick<GameSave, "discoveredFishIds" | "pity" | "equipmentLevels">
): RarityWeights {
  return getRarityWeights(
    save.discoveredFishIds,
    save.pity.consecutiveNonLegendary,
    getEquipmentEffect("line", save.equipmentLevels.line)
  );
}

/** Seconds between catches for a rod level (multiplier read from equipment data). */
export function getFishingIntervalSeconds(rodLevel: number): number {
  return Math.max(
    GAME_CONFIG.minimumFishingIntervalSeconds,
    Math.round(GAME_CONFIG.baseFishingIntervalSeconds * getEquipmentEffect("rod", rodLevel))
  );
}

/** Pick a rarity from weights with one rng draw. */
export function pickRarity(weights: RarityWeights, rng: () => number): FishRarity {
  const roll = rng() * 100;
  let cumulative = 0;
  let lastAvailable: FishRarity = "common";
  for (const rarity of RARITY_ORDER) {
    if (weights[rarity] <= 0) continue;
    lastAvailable = rarity;
    cumulative += weights[rarity];
    if (roll < cumulative) return rarity;
  }
  return lastAvailable; // only reachable through floating-point drift
}

/** Pick a fish of this rarity uniformly with one rng draw. */
export function chooseFishForRarity(rarity: FishRarity, rng: () => number = Math.random): FishDefinition {
  const candidates = FISH.filter((fish) => fish.rarity === rarity);
  if (candidates.length === 0) {
    throw new Error(`No fish available for rarity: ${rarity}`);
  }
  const index = Math.min(candidates.length - 1, Math.floor(rng() * candidates.length));
  return candidates[index];
}

/** Rarity roll for explicit inputs (see `getRarityWeights`). One rng draw. */
export function chooseRarity(
  discoveredFishIds: readonly string[],
  pityCount: number,
  rng: () => number = Math.random,
  lineEffect = 0
): FishRarity {
  return pickRarity(getRarityWeights(discoveredFishIds, pityCount, lineEffect), rng);
}

/**
 * Decide which fish bites: rarity from the save's weights (unlocks, pity, line), then a
 * uniform fish of that rarity. Uses exactly two rng draws. Does not modify the save;
 * pass the result to `applyCatch`.
 */
export function rollCatch(save: GameSave, rng: () => number = Math.random): FishDefinition {
  const rarity = pickRarity(getSaveRarityWeights(save), rng);
  return chooseFishForRarity(rarity, rng);
}

/** True for fish that trigger the optional reel-in minigame (rare and above). */
export function isMinigameEligible(fish: FishDefinition): boolean {
  return !fish.autoSell;
}
