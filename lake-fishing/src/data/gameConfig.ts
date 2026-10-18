import type { FishRarity } from "../types/game";

/** Rarities from most common to rarest (also the unlock order). */
export const RARITY_ORDER: readonly FishRarity[] = ["common", "uncommon", "rare", "epic", "legendary"];

/**
 * Central tunables. Everything the PRD marks as "to be balanced" (PRD §17) lives here:
 * line effect (equipment.ts), bait target group, minigame ratios and the streak bonus.
 */
export const GAME_CONFIG = {
  saveVersion: 3,
  startingCoins: 0,
  /**
   * Rod (PRD §7): interval = Math.max(minimumIntervalSeconds,
   *   Math.round(baseIntervalSeconds * (1 - reductionPerLevel * (rodLevel - 1)))).
   */
  rod: {
    baseIntervalSeconds: 90,
    reductionPerLevel: 0.08,
    minimumIntervalSeconds: 30
  },
  /**
   * Bait (PRD §7): multiplies the pick weight of `targetFishIds` among the fish of the SAME
   * rarity (multiplier per level: equipment.ts, Lv1 x1.0 -> Lv6 x2.0). It never changes rarity
   * probabilities or prices. Default group: the carp family.
   */
  bait: {
    groupName: "鯉科魚群",
    targetFishIds: [
      "fish_crucian_carp", // 小鯽魚
      "fish_carp", // 鯉魚
      "fish_gibel", // 鯽魚
      "fish_koi_gibel", // 彩鯽
      "fish_silver_gibel", // 銀鯽
      "fish_golden_carp", // 金色鯉魚
      "fish_koi", // 錦鯉
      "fish_moonlight_carp" // 月光鯉
    ] as readonly string[]
  },
  offline: {
    maxSeconds: 4 * 60 * 60,
    efficiency: 0.5
  },
  collectionUnlocks: {
    common: 0,
    uncommon: 5,
    rare: 10,
    epic: 15,
    legendary: 20
  } satisfies Record<FishRarity, number>,
  rarityWeights: {
    common: 60,
    uncommon: 25,
    rare: 11,
    epic: 3.5,
    legendary: 0.5
  } satisfies Record<FishRarity, number>,
  legendaryPity: [
    { min: 0, max: 49, chance: 0.005 },
    { min: 50, max: 99, chance: 0.0075 },
    { min: 100, max: 149, chance: 0.01 },
    { min: 150, max: 199, chance: 0.015 },
    { min: 200, max: null, chance: 0.02 }
  ],
  /**
   * Optional bobber-timing minigame (PRD §9). Positions are fractions of the timing bar (0..1).
   * A miss or no tap costs nothing.
   */
  minigame: {
    /** The last N seconds of every countdown are the timing window. */
    windowSeconds: 3,
    /** Indicator speed in bar lengths per second; it ping-pongs from 0 to 1 and back. */
    indicatorSpeed: 0.6,
    /** Width of the "success" zone. */
    timingZoneWidth: 0.3,
    /** Width of the centred "perfect" zone (narrower than the timing zone). */
    perfectZoneWidth: 0.1,
    /** Bonus coins for a success = ceil(sellPrice * successRatio), at most `bonusCap`. */
    successRatio: 0.2,
    /** Bonus coins for a perfect = ceil(sellPrice * perfectRatio), at most `bonusCap`. */
    perfectRatio: 0.5,
    /** Maximum extra coins per round (PRD §9). */
    bonusCap: 25,
    /**
     * Relative boost to the weight of every unlocked rare+ tier per consecutive perfect
     * (0.05 = +5%). 0 = off by default (PRD §17: still to be balanced).
     */
    streakBonusPerPerfect: 0,
    /** Ceiling of the total streak boost (0.5 = rare+ weights at most x1.5). */
    streakBonusMax: 0.5
  }
} as const;

export type RodConfig = {
  readonly baseIntervalSeconds: number;
  readonly reductionPerLevel: number;
  readonly minimumIntervalSeconds: number;
};

export type MinigameConfig = {
  readonly windowSeconds: number;
  readonly indicatorSpeed: number;
  readonly timingZoneWidth: number;
  readonly perfectZoneWidth: number;
  readonly successRatio: number;
  readonly perfectRatio: number;
  readonly bonusCap: number;
  readonly streakBonusPerPerfect: number;
  readonly streakBonusMax: number;
};
