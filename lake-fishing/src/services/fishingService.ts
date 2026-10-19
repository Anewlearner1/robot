import { clampEquipmentLevel, getEquipmentEffect } from "../data/equipment";
import { FISH } from "../data/fish";
import { GAME_CONFIG, RARITY_ORDER } from "../data/gameConfig";
import type { MinigameConfig, RodConfig } from "../data/gameConfig";
import type { FishDefinition, FishRarity, GameSave } from "../types/game";
import { countDiscoveredFish } from "./encyclopediaService";
import { GameLogicError } from "./errors";
import { getStreakBonus } from "./minigameService";
import { assertValidFish } from "./validationService";

export { RARITY_ORDER };

/** Rarity weights as percentages. Locked rarities are 0; the rest add up to 100. */
export type RarityWeights = Record<FishRarity, number>;

const emptyWeights = (): RarityWeights => ({ common: 0, uncommon: 0, rare: 0, epic: 0, legendary: 0 });

/** A usable weight: a finite number above 0. Negative, NaN, +-Infinity and non-numbers count as 0. */
const validWeight = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;

/** The largest double below 1, so `unit * total` can never reach `total`. */
const MAX_UNIT = 1 - Number.EPSILON / 2;

/**
 * One draw from the injected `random()`, clamped into [0, 1). A value that is not a finite number
 * (NaN, +-Infinity, undefined) is a broken random source and throws `INVALID_RANDOM_VALUE`
 * instead of silently picking the rarest option.
 */
function drawUnit(rng: () => number): number {
  const value = rng();
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new GameLogicError("INVALID_RANDOM_VALUE", `random() must return a finite number, got ${String(value)}.`);
  }
  return Math.min(MAX_UNIT, Math.max(0, value));
}

/** Rarities available to the player, based on how many distinct fish were discovered. */
export function getUnlockedRarities(discoveredFishIds: readonly string[]): FishRarity[] {
  const collectionCount = countDiscoveredFish(discoveredFishIds);
  return RARITY_ORDER.filter((rarity) => collectionCount >= GAME_CONFIG.collectionUnlocks[rarity]);
}

/**
 * Base weights restricted to unlocked rarities and rescaled to total 100. Invalid configured
 * weights (negative, NaN, +-Infinity) are treated as 0, so such a rarity is never rolled and the
 * others still total 100. When no unlocked rarity has a valid weight every weight is 0 (and
 * `pickRarity` then throws `NO_VALID_RARITY_WEIGHTS`). `baseWeights` is injectable for tests.
 */
export function getBaseRarityWeights(
  unlocked: readonly FishRarity[],
  baseWeights: Readonly<Record<FishRarity, number>> = GAME_CONFIG.rarityWeights
): RarityWeights {
  const weights = emptyWeights();
  const tiers = [...new Set(unlocked)];
  const total = tiers.reduce((sum, rarity) => sum + validWeight(baseWeights[rarity]), 0);
  if (!(total > 0)) return weights;
  for (const rarity of tiers) {
    weights[rarity] = (validWeight(baseWeights[rarity]) / total) * 100;
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

/** Unlocked tiers that count as "special fish" for the perfect-streak boost. */
const STREAK_BOOSTED: readonly FishRarity[] = ["rare", "epic", "legendary"];

/**
 * Perfect-streak boost: multiply the weight of every UNLOCKED rare+ tier by (1 + bonus) and
 * rescale so the total is unchanged. A locked tier has weight 0 and is skipped explicitly, so
 * a streak can never unlock anything. Does nothing for bonus <= 0.
 */
export function applyStreakBonus(
  weights: RarityWeights,
  unlocked: readonly FishRarity[],
  bonus: number
): RarityWeights {
  const result = { ...weights };
  if (!(bonus > 0)) return result;
  const before = RARITY_ORDER.reduce((sum, rarity) => sum + weights[rarity], 0);
  for (const rarity of STREAK_BOOSTED) {
    if (unlocked.includes(rarity)) result[rarity] = weights[rarity] * (1 + bonus);
  }
  const after = RARITY_ORDER.reduce((sum, rarity) => sum + result[rarity], 0);
  if (before <= 0 || after <= 0) return { ...weights };
  const scale = before / after;
  for (const rarity of RARITY_ORDER) result[rarity] *= scale;
  return result;
}

/**
 * Final rarity weights (percent, total 100 over unlocked rarities, 0 for locked ones):
 * base weights (unlock filter) -> line effect -> perfect-streak boost -> legendary pity.
 * Bait is not involved: it only changes which fish of a rarity is picked.
 * @param lineEffect raw line effectValue (0..0.10); see `getEquipmentEffect("line", level)`.
 * @param perfectStreak consecutive perfect minigame taps (0 = no boost).
 */
export function getRarityWeights(
  discoveredFishIds: readonly string[],
  pityCount = 0,
  lineEffect = 0,
  perfectStreak = 0,
  minigameConfig: Pick<MinigameConfig, "streakBonusPerPerfect" | "streakBonusMax"> = GAME_CONFIG.minigame
): RarityWeights {
  const unlocked = getUnlockedRarities(discoveredFishIds);
  const base = getBaseRarityWeights(unlocked);
  const lined = applyLineEffect(base, unlocked, lineEffect);
  const boosted = applyStreakBonus(lined, unlocked, getStreakBonus(perfectStreak, minigameConfig));
  return applyLegendaryPity(boosted, unlocked, pityCount);
}

/** `getRarityWeights` using a save's discoveries, pity counter, line level and perfect streak. */
export function getSaveRarityWeights(
  save: Pick<GameSave, "discoveredFishIds" | "pity" | "equipmentLevels" | "minigame">
): RarityWeights {
  return getRarityWeights(
    save.discoveredFishIds,
    save.pity.consecutiveNonLegendary,
    getEquipmentEffect("line", save.equipmentLevels.line),
    save.minigame.perfectStreak
  );
}

/**
 * Seconds between catches for a rod level (PRD §7):
 * `Math.max(30, Math.round(90 * (1 - 0.08 * (rodLevel - 1))))`, with the three constants read
 * from `GAME_CONFIG.rod` (or the `config` argument). Out-of-range levels are clamped to 1..6.
 */
export function getFishingIntervalSeconds(rodLevel: number, config: RodConfig = GAME_CONFIG.rod): number {
  const level = clampEquipmentLevel("rod", rodLevel);
  return Math.max(
    config.minimumIntervalSeconds,
    Math.round(config.baseIntervalSeconds * (1 - config.reductionPerLevel * (level - 1)))
  );
}

/**
 * Pick a rarity from weights with one rng draw: `roll = random() * sum(valid weights)` is walked
 * through the cumulative weights in `RARITY_ORDER`, so a value exactly on a boundary (e.g. 0.6
 * with 60/25/11/3.5/0.5) belongs to the next rarity. Weights that are negative, NaN or infinite
 * count as 0 and are never picked. Throws `GameLogicError("NO_VALID_RARITY_WEIGHTS")`, without
 * drawing, when no rarity has a valid weight, and `INVALID_RANDOM_VALUE` for a non-finite draw.
 */
export function pickRarity(weights: RarityWeights, rng: () => number): FishRarity {
  const valid = RARITY_ORDER.map((rarity) => validWeight(weights[rarity]));
  const total = valid.reduce((sum, weight) => sum + weight, 0);
  if (!(total > 0) || !Number.isFinite(total)) {
    throw new GameLogicError("NO_VALID_RARITY_WEIGHTS", "No rarity has a finite, positive weight; nothing can be rolled.");
  }
  const roll = drawUnit(rng) * total;
  let cumulative = 0;
  let lastAvailable: FishRarity = "common";
  for (const [index, rarity] of RARITY_ORDER.entries()) {
    if (valid[index] <= 0) continue;
    lastAvailable = rarity;
    cumulative += valid[index];
    if (roll < cumulative) return rarity;
  }
  return lastAvailable; // only reachable through floating-point drift
}

/** Bait pick-weight multiplier of the target group at a level (Lv1 x1.0 -> Lv6 x2.0). */
export function getBaitMultiplier(baitLevel: number): number {
  return getEquipmentEffect("bait", baitLevel);
}

/** The fish the bait favours (`GAME_CONFIG.bait.targetFishIds`), as definitions. */
export function getBaitTargetFish(targetFishIds: readonly string[] = GAME_CONFIG.bait.targetFishIds): FishDefinition[] {
  return FISH.filter((fish) => targetFishIds.includes(fish.id));
}

/** One fish of a rarity with its pick weight and its share (0..1) among that rarity. */
export interface FishPickChance {
  fish: FishDefinition;
  /** 1 for ordinary fish; the bait multiplier for target fish. */
  weight: number;
  /** weight / sum of weights of the rarity. */
  chance: number;
}

/**
 * Pick weights of every fish of one rarity at a bait level, in catalogue order. Bait multiplies
 * the weight of the target fish only; weights are within the rarity, so the rarity's own
 * probability is not affected.
 */
export function getFishPickChances(
  rarity: FishRarity,
  baitLevel = 1,
  targetFishIds: readonly string[] = GAME_CONFIG.bait.targetFishIds,
  pool: readonly FishDefinition[] = FISH
): FishPickChance[] {
  const multiplier = getBaitMultiplier(baitLevel);
  const candidates = pool.filter((fish) => fish.rarity === rarity);
  const weights = candidates.map((fish) => (targetFishIds.includes(fish.id) ? multiplier : 1));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  return candidates.map((fish, index) => ({
    fish,
    weight: weights[index],
    chance: total > 0 ? weights[index] / total : 0
  }));
}

/**
 * Pick a fish of this rarity with one rng draw. Fish are weighted 1, except the bait's target
 * fish, which get the bait multiplier; non-target fish stay possible at every bait level.
 * With bait level 1 this is a uniform pick. The roll is `random() * sum(weights)` walked through
 * the cumulative weights in catalogue order (a value exactly on a boundary belongs to the next fish).
 * `pool` is injectable for tests. Throws `GameLogicError("EMPTY_FISH_POOL")` when the pool has no
 * fish of this rarity, `INVALID_FISH_DATA` for a candidate that would corrupt a save, and
 * `INVALID_RANDOM_VALUE` for a non-finite draw (checked after the pool, so an empty pool never
 * consumes a draw).
 */
export function chooseFishForRarity(
  rarity: FishRarity,
  rng: () => number = Math.random,
  baitLevel = 1,
  pool: readonly FishDefinition[] = FISH
): FishDefinition {
  const chances = getFishPickChances(rarity, baitLevel, GAME_CONFIG.bait.targetFishIds, pool);
  if (chances.length === 0) {
    throw new GameLogicError("EMPTY_FISH_POOL", `No fish available for rarity: ${rarity}`);
  }
  for (const entry of chances) assertValidFish(entry.fish);
  const total = chances.reduce((sum, entry) => sum + entry.weight, 0);
  const roll = drawUnit(rng) * total;
  let cumulative = 0;
  for (const entry of chances) {
    cumulative += entry.weight;
    if (roll < cumulative) return entry.fish;
  }
  return chances[chances.length - 1].fish;
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
 * Decide which fish bites: rarity from the save's weights (unlocks, line, perfect streak, pity),
 * then a fish of that rarity weighted by the bait. Uses exactly two rng draws. Does not modify
 * the save; pass the result to `applyCatch`.
 * @param options.perfectStreak override the streak used for the roll (offline passes 0).
 */
export function rollCatch(
  save: GameSave,
  rng: () => number = Math.random,
  options: { perfectStreak?: number } = {}
): FishDefinition {
  const weights = getRarityWeights(
    save.discoveredFishIds,
    save.pity.consecutiveNonLegendary,
    getEquipmentEffect("line", save.equipmentLevels.line),
    options.perfectStreak ?? save.minigame.perfectStreak
  );
  const rarity = pickRarity(weights, rng);
  return chooseFishForRarity(rarity, rng, save.equipmentLevels.bait);
}
