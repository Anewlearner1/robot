import type { FishRarity } from "../types/game";

export const GAME_CONFIG = {
  saveVersion: 2,
  startingCoins: 0,
  baseFishingIntervalSeconds: 90,
  minimumFishingIntervalSeconds: 30,
  /** Sell-price multiplier for a fish won in the reel-in minigame. */
  perfectSellMultiplier: 1.5,
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
   * Reel-in minigame (tension bar). All rates are "fraction of the bar per second".
   * Tuned to be relaxing: a player who simply follows the green zone succeeds
   * almost every time, a half-attentive one usually does, and walking away fails.
   */
  minigame: {
    /** Bite prompt auto-lands the fish (no reward bonus) after this long. */
    promptTimeoutMs: 15_000,
    /** Round ends in failure after this long. */
    timeLimitMs: 12_000,
    /** Catch progress at the start (0..1). */
    startProgress: 0.15,
    /** Progress gained per second while the indicator is inside the green zone. */
    fillPerSecond: 0.16,
    /** Progress lost per second outside it; much gentler than the fill rate. */
    drainPerSecond: 0.05,
    /** Indicator speed while holding (reeling in). */
    reelPerSecond: 0.55,
    /** Indicator speed while released (line pays out); slightly slower than reeling. */
    releasePerSecond: 0.45,
    zoneHalfWidth: 0.18,
    /** The green zone drifts along a sine wave of this amplitude around the bar's middle. */
    zoneAmplitude: 0.2,
    zonePeriodMs: { min: 5_000, max: 8_000 },
    /** `stepMinigame` integrates in sub-steps no longer than this, so big dt values stay stable. */
    maxStepMs: 50
  }
} as const;
