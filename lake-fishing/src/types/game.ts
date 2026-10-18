export type FishRarity =
  | "common"
  | "uncommon"
  | "rare"
  | "epic"
  | "legendary";

export type EquipmentType = "rod" | "line" | "bait";

export interface FishDefinition {
  id: string;
  name: string;
  rarity: FishRarity;
  sellPrice: number;
  description: string;
  imageKey: string;
  unlockCollectionCount: number;
  /** true for common/uncommon: sold immediately. false: goes to the pending list (sell or keep). */
  autoSell: boolean;
}

export interface EquipmentLevelConfig {
  level: number;
  upgradeCost: number | null;
  effectValue: number;
}

export interface EquipmentDefinition {
  id: EquipmentType;
  name: string;
  description: string;
  maxLevel: number;
  levels: EquipmentLevelConfig[];
}

/** Where a catch came from. */
export type CatchSource = "active" | "offline" | "minigame";

/** The result of one bobber-timing tap. */
export type TapResult = "perfect" | "success" | "miss";

/** A minigame round result; "none" means the player did not tap (or did not take part). */
export type MinigameResult = TapResult | "none";

/** What the bobber-timing minigame reported for one catch; pass it to `applyCatch`. */
export interface MinigameOutcome {
  result: MinigameResult;
}

/**
 * A rare+ catch waiting for the player to sell or keep it. Entries of the same fish and
 * source are merged into one row with a larger `quantity`.
 */
export interface PendingFish {
  id: string;
  fishId: string;
  /** Positive integer. */
  quantity: number;
  /** When the latest fish of this row was caught. */
  caughtAt: number;
  source: CatchSource;
}

export const CURRENT_SAVE_VERSION = 3;

export interface GameSave {
  saveVersion: number;
  createdAt: number;
  lastSavedAt: number;
  /**
   * The moment up to which offline time has already been paid out (or the player was seen
   * active). Only ever moves forward: a clock that went backwards never moves it back.
   */
  lastOfflineSettlementAt: number;
  coins: number;
  equipmentLevels: Record<EquipmentType, number>;
  /** Known fish ids, unique, in order of discovery. */
  discoveredFishIds: string[];
  /** Lifetime catches per fish id (only ids with count >= 1 are present). */
  catchCounts: Record<string, number>;
  /** Kept fish: fish id -> count (only ids with count >= 1 are present). */
  fishInventory: Record<string, number>;
  /** Rare+ fish waiting to be sold or kept. */
  pendingFish: PendingFish[];
  /** Counter used to mint unique pending ids. */
  nextPendingId: number;
  pity: {
    consecutiveNonLegendary: number;
  };
  stats: {
    totalCatches: number;
    totalFishSold: number;
    totalCoinsEarned: number;
  };
  minigame: {
    /** Consecutive perfect minigame taps. */
    perfectStreak: number;
  };
  settings: {
    soundEnabled: boolean;
    musicEnabled: boolean;
    /** 0..1 */
    musicVolume: number;
    reducedMotion: boolean;
  };
}

/** What happened when one fish was resolved by `applyCatch`. */
export interface CatchEvent {
  fishId: string;
  rarity: FishRarity;
  caughtAt: number;
  source: CatchSource;
  /** "sold": auto-sold for coins. "pending": waiting in the pending list. */
  outcome: "sold" | "pending";
  /** Coins credited right now: the auto-sale price plus the minigame bonus. */
  coinsEarned: number;
  /** Part of `coinsEarned` that is the auto-sale price (0 when the fish went to pending). */
  saleCoins: number;
  /** Part of `coinsEarned` that is the minigame bonus (0 for a miss / no minigame). */
  bonusCoins: number;
  /** The minigame result that was applied; null when no outcome was passed. */
  minigameResult: MinigameResult | null;
  /** The pending row this fish went into (after merging); null when auto-sold. */
  pendingFish: PendingFish | null;
  isNewDiscovery: boolean;
  /** Rarity tiers that became available because of this discovery. */
  newlyUnlockedRarities: FishRarity[];
  pity: {
    before: number;
    after: number;
    /** true when a legendary was caught and the counter went back to 0. */
    reset: boolean;
  };
  /** Perfect streak before and after this catch (unchanged when no minigame outcome was passed). */
  perfectStreak: { before: number; after: number };
  /** Lifetime count of this species after this catch. */
  speciesCatchCount: number;
}

/** Summary shown in the "while you were away..." card. */
export interface OfflineSummary {
  fromTimestamp: number;
  toTimestamp: number;
  /** Real time away, never negative. */
  elapsedSeconds: number;
  /** Time that actually counts (capped at 4h). */
  cappedSeconds: number;
  intervalSeconds: number;
  effectiveCatches: number;
  /** Number of fish that were auto-sold. */
  soldCount: number;
  coinsEarned: number;
  /** Fish ids discovered for the first time, in order. */
  newDiscoveries: string[];
  newlyUnlockedRarities: FishRarity[];
  /** Rare+ fish sent to the pending list, summed per species (first-caught order). */
  pendingAdditions: { fishId: string; quantity: number }[];
  /** Per-species catches during the absence. */
  catchesByFish: Record<string, number>;
}
