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
  /** true for common/uncommon: sold immediately. false: goes to the inventory. */
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

/** One rare+ fish kept in the backpack. Each has a unique instance id. */
export interface InventoryItem {
  id: string;
  fishId: string;
  /** Won the reel-in minigame: sells for x1.5. */
  perfect: boolean;
  caughtAt: number;
}

export const CURRENT_SAVE_VERSION = 2;

export interface GameSave {
  saveVersion: number;
  createdAt: number;
  lastSavedAt: number;
  /** Last moment the player was actively in the game (foreground). Offline time is measured from here. */
  lastActiveAt: number;
  coins: number;
  equipmentLevels: Record<EquipmentType, number>;
  /** Known fish ids, unique, in order of discovery. */
  discoveredFishIds: string[];
  /** Lifetime catches per fish id (only ids with count >= 1 are present). */
  catchCounts: Record<string, number>;
  /** Rare+ fish waiting to be sold or kept. */
  inventory: InventoryItem[];
  /** Counter used to mint unique inventory item ids. */
  nextInventoryId: number;
  pity: {
    consecutiveNonLegendary: number;
  };
  stats: {
    totalCatches: number;
    totalFishSold: number;
    totalCoinsEarned: number;
  };
  settings: {
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
  /** "sold": auto-sold for coins. "inventory": added to the backpack. */
  outcome: "sold" | "inventory";
  /** Coins credited right now (0 when the fish went to the inventory). */
  coinsEarned: number;
  /** The backpack entry that was created (null when auto-sold). */
  inventoryItem: InventoryItem | null;
  perfect: boolean;
  isNewDiscovery: boolean;
  /** Rarity tiers that became available because of this discovery. */
  newlyUnlockedRarities: FishRarity[];
  pity: {
    before: number;
    after: number;
    /** true when a legendary was caught and the counter went back to 0. */
    reset: boolean;
  };
  /** Lifetime count of this species after this catch. */
  speciesCatchCount: number;
}

/** Summary shown in the "while you were away..." dialog. */
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
  /** Rare+ fish added to the backpack. */
  inventoryAdditions: InventoryItem[];
  /** Per-species catches during the absence. */
  catchesByFish: Record<string, number>;
}
