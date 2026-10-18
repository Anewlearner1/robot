/**
 * Public game-logic API for the UI. Everything here is a pure function (inject `rng` and `now`)
 * except `loadFromLocalStorage` / `saveToLocalStorage`, which touch localStorage and never throw.
 * Never mutate a GameSave: every function returns a new one.
 *
 * Typical loop:
 *   const loaded = loadFromLocalStorage();               // none | loaded | corrupt (backed up)
 *   const { save, summary } = settleOffline(save, now, rng);   // "while you were away" dialog
 *   every getFishingIntervalSeconds(save.equipmentLevels.rod) s:
 *     const fish = rollCatch(save, rng);
 *     rare+ (isMinigameEligible)? offer minigame (15 s prompt) -> perfect = isPerfectResult(state)
 *     const { save: next, event } = applyCatch(save, fish.id, { perfect, now });
 *     saveToLocalStorage(next);
 */

// --- Types --------------------------------------------------------------------------------
export type {
  CatchEvent,
  EquipmentType,
  FishDefinition,
  FishRarity,
  GameSave,
  InventoryItem,
  OfflineSummary
} from "../types/game";
export { CURRENT_SAVE_VERSION } from "../types/game";

// --- Catching -----------------------------------------------------------------------------
export {
  /** Seconds between catches for a rod level (rod multiplier read from equipment data). */
  getFishingIntervalSeconds,
  /** Decide which fish bites (rarity from unlocks + pity + line effect, then a uniform fish). 2 rng draws. */
  rollCatch,
  /** True when the fish is rare+ and should offer the optional reel-in minigame. */
  isMinigameEligible,
  /** Final rarity weights in percent (total 100; 0 for locked rarities) for the given inputs. */
  getRarityWeights,
  /** `getRarityWeights` computed from a save (discoveries, pity counter, line level). */
  getSaveRarityWeights,
  /** Rarities currently unlocked by the number of discovered species. */
  getUnlockedRarities,
  /** Legendary chance (0..1) at a pity count. */
  getLegendaryChance
} from "./fishingService";
export type { RarityWeights } from "./fishingService";

export {
  /** Resolve a caught fish: auto-sell or add to backpack, register in the encyclopedia, update pity/stats. Returns new save + event. */
  applyCatch
} from "./catchService";
export type { ApplyCatchOptions } from "./catchService";

// --- Inventory & selling ------------------------------------------------------------------
export {
  /** Sell one backpack item by instance id. */
  sellInventoryItem,
  /** Sell the whole backpack (ask the player to confirm first). */
  sellAllInventory,
  /** Current sell price of a backpack item (bait multiplier and perfect bonus included). */
  getInventoryItemPrice,
  /** Total current value of the backpack. */
  getInventoryValue
} from "./catchService";
export type { SellItemResult, SellAllResult } from "./catchService";

// --- Equipment ----------------------------------------------------------------------------
export {
  /** Buy the next level of rod/line/bait. Returns the new save and the result (failure leaves the save as is). */
  upgradeEquipment,
  /** Pure upgrade check on (type, level, coins). */
  tryUpgradeEquipment,
  /** Current/next effect text, cost and affordability for the upgrade screen. */
  describeEquipmentUpgrade,
  /** Bait sell multiplier at a level. */
  getSellMultiplier,
  /** sellPrice x bait multiplier x (perfect ? 1.5 : 1), rounded. */
  calculateSalePrice
} from "./economyService";
export type { UpgradeResult, EquipmentUpgradeInfo } from "./economyService";

// --- Encyclopedia -------------------------------------------------------------------------
export {
  /** Discovered / total / percentage, ignoring unknown ids. */
  getCollectionProgress,
  /** All 25 slots with discovered flag and lifetime catch count. */
  getEncyclopediaEntries
} from "./encyclopediaService";
export type { EncyclopediaEntry } from "./encyclopediaService";

// --- Offline ------------------------------------------------------------------------------
export {
  /** Simulate the time away (cap 4h, 50% efficiency) catch by catch. Returns new save (lastActiveAt = now) + summary. */
  settleOffline,
  /** Just the arithmetic: elapsed/capped seconds and effective catch count. */
  calculateOfflineCatches
} from "./offlineService";

// --- Minigame -----------------------------------------------------------------------------
export {
  /** Start a round of the tension-bar minigame (rng seeds the green zone's drift). */
  createMinigameState,
  /** Advance a round by dtMs; `holding` = reel button down. Status becomes 'success' or 'fail'. */
  stepMinigame,
  /** Fraction of the time limit used (0..1). */
  getMinigameTimeFraction,
  /** True once the bite prompt has gone 15 s unanswered: auto-land the fish, not perfect. */
  isMinigamePromptExpired,
  /** True when the round was won: pass as `perfect` to applyCatch. */
  isPerfectResult
} from "./minigameService";
export type { MinigameConfig, MinigameState, MinigameStatus } from "./minigameService";

// --- Saving -------------------------------------------------------------------------------
export {
  /** A brand-new save. */
  createNewSave,
  /** Load: { status: 'none' } | { status:'loaded', save } | { status:'corrupt', backupKey, save: fresh }. Corrupt data is backed up, never overwritten. */
  loadFromLocalStorage,
  /** Write to localStorage (stamps lastSavedAt/lastActiveAt). Never throws; returns { ok, save } or { ok:false, error }. */
  saveToLocalStorage,
  /** Pretty JSON for the export button. */
  exportSaveJson,
  /** Import: parse + migrate + validate, or throw an Error with a Chinese message. */
  parseImportedSave,
  /** Full validator for a v2 save. */
  validateSave,
  /** Human-readable list of what is wrong with a save (empty = valid). */
  getSaveValidationErrors,
  /** Upgrade an older save object to the current version. */
  migrateSave,
  /** Change music/motion settings (volume is clamped to 0..1). */
  updateSettings,
  /** Stamp lastActiveAt (e.g. on visibilitychange -> visible after settling). */
  markActive,
  SAVE_KEY,
  CORRUPT_SAVE_KEY_PREFIX
} from "./saveService";
export type { LoadResult, SaveWriteResult, MigrationResult } from "./saveService";
