/**
 * Public game-logic API for the UI. Everything here is a pure function (inject `rng` and `now`)
 * except `loadFromLocalStorage` / `saveToLocalStorage`, which touch localStorage and never throw.
 * Never mutate a GameSave: every function returns a new one (or the same object when nothing
 * changed). Sale price is always `fish.sellPrice`; there are no multipliers.
 *
 * Typical loop:
 *   const loaded = loadFromLocalStorage();                    // none | loaded | corrupt (backed up)
 *   const { save, summary } = settleOffline(save, now, rng);  // "while you were away" card
 *   heartbeat every 30 s / on hide: save = markActive(save, now)
 *   every getFishingIntervalSeconds(save.equipmentLevels.rod) s:
 *     last 3 s (isMinigameWindowOpen): round = createTimingRound(); tap -> tapRound(round, elapsedMs)
 *     const fish = rollCatch(save, rng);
 *     const { save: next, event } = applyCatch(save, fish.id,
 *       { source, now, minigame: { result: getRoundResult(round) } });
 *     rare+ lands in next.pendingFish -> sellPending / keepPending (-> fishInventory -> sellInventoryFish)
 *     saveToLocalStorage(next);
 */

// --- Types --------------------------------------------------------------------------------
export type {
  /** What `applyCatch` reports about one resolved fish. */
  CatchEvent,
  /** Where a catch came from: "active" | "offline" | "minigame". */
  CatchSource,
  /** "rod" | "line" | "bait". */
  EquipmentType,
  /** Static definition of one fish species. */
  FishDefinition,
  /** "common" | "uncommon" | "rare" | "epic" | "legendary". */
  FishRarity,
  /** The whole save file (v3). */
  GameSave,
  /** Minigame result including "none" (no tap). */
  MinigameResult,
  /** `{ result }` handed to `applyCatch`. */
  MinigameOutcome,
  /** The "while you were away" summary returned by `settleOffline`. */
  OfflineSummary,
  /** A rare+ catch waiting to be sold or kept. */
  PendingFish,
  /** One tap's result: "perfect" | "success" | "miss". */
  TapResult
} from "../types/game";
export {
  /** The save version this build reads and writes (3). */
  CURRENT_SAVE_VERSION
} from "../types/game";
export {
  /** Rarities from most common to rarest (also the unlock order). */
  RARITY_ORDER,
  /** All tunables (rod, bait, minigame, unlock thresholds...); read-only for the UI, e.g. `GAME_CONFIG.minigame.windowSeconds`. */
  GAME_CONFIG
} from "../data/gameConfig";
export type {
  /** Tunables of the bobber-timing minigame. */
  MinigameConfig,
  /** Tunables of the rod interval formula. */
  RodConfig
} from "../data/gameConfig";

// --- Catching -----------------------------------------------------------------------------
export {
  /** Seconds between catches: `Math.max(30, Math.round(90 * (1 - 0.08 * (rodLevel - 1))))`, constants from config. */
  getFishingIntervalSeconds,
  /** Decide which fish bites (rarity from unlocks + line + streak + pity, then a bait-weighted fish of that rarity). 2 rng draws. */
  rollCatch,
  /** Final rarity weights in percent (total 100; 0 for locked rarities). Bait never changes these. */
  getRarityWeights,
  /** `getRarityWeights` computed from a save (discoveries, pity, line level, perfect streak). */
  getSaveRarityWeights,
  /** Rarities currently unlocked by the number of discovered species. */
  getUnlockedRarities,
  /** Legendary chance (0..1) at a pity count. */
  getLegendaryChance,
  /** Perfect-streak boost of the rare+ tiers (applied after the unlock filter, before pity). */
  applyStreakBonus,
  /** Bait pick-weight multiplier of the target group at a level (x1.0 .. x2.0). */
  getBaitMultiplier,
  /** The fish the bait favours, as definitions. */
  getBaitTargetFish,
  /** Each fish of a rarity with its bait-adjusted pick weight and share within the rarity. */
  getFishPickChances,
  /** Pick a fish of a rarity with one rng draw, weighted by bait level. */
  chooseFishForRarity
} from "./fishingService";
export type {
  /** Rarity -> percent. */
  RarityWeights,
  /** A fish with its pick weight and share within its rarity. */
  FishPickChance
} from "./fishingService";

export {
  /** Resolve a caught fish: auto-sell common/uncommon at sellPrice, rare+ to pendingFish, pay the minigame bonus, update encyclopedia/pity/streak/stats. Returns new save + event. */
  applyCatch
} from "./catchService";
export type {
  /** `{ source, now, minigame? }` for `applyCatch`. */
  ApplyCatchOptions
} from "./catchService";

// --- Pending, kept fish & selling ---------------------------------------------------------
export {
  /** Sell qty (default all) of one pending row at sellPrice. `{ ok:false, reason }` on any invalid request. */
  sellPending,
  /** Move qty (default all) of one pending row into fishInventory. `{ ok:false, reason }` on any invalid request. */
  keepPending,
  /** Sell qty kept fish of one species at sellPrice. `{ ok:false, reason }` on any invalid request. */
  sellInventoryFish,
  /** Sell the whole pending list (ask the player to confirm first). */
  sellAllPending,
  /** Sell every kept fish (ask the player to confirm first). */
  sellAllInventory,
  /** Total value of the pending list. */
  getPendingValue,
  /** Total value of the kept fish. */
  getInventoryValue,
  /** Pending rows with fish definition and prices, ready to display. */
  getPendingEntries,
  /** Kept species (catalogue order) with count and prices, ready to display. */
  getInventoryEntries
} from "./catchService";
export type {
  /** Why a sell / keep request was refused. */
  TradeFailureReason,
  /** Result of selling one row / species. */
  SellResult,
  /** Result of keeping a pending row. */
  KeepResult,
  /** Result of a sell-all. */
  SellAllResult,
  /** A pending row plus its fish and prices. */
  PendingEntry,
  /** A kept species plus count and prices. */
  InventoryEntry
} from "./catchService";

// --- Equipment ----------------------------------------------------------------------------
export {
  /** Buy the next level of rod/line/bait. Returns the new save and the result (failure leaves the save as is). */
  upgradeEquipment,
  /** Pure upgrade check on (type, level, coins). */
  tryUpgradeEquipment,
  /** Current/next effect text, cost, affordability and `shortfall` for the upgrade screen. */
  describeEquipmentUpgrade,
  /** Coins for selling n fish: `fish.sellPrice * n`, no multiplier. */
  getSalePrice
} from "./economyService";
export type {
  /** Result of an upgrade attempt. */
  UpgradeResult,
  /** Everything the upgrade screen shows for one equipment. */
  EquipmentUpgradeInfo
} from "./economyService";

// --- Encyclopedia -------------------------------------------------------------------------
export {
  /** `{ discovered, total, percent }`, ignoring unknown ids. */
  getCollectionProgress,
  /** The next locked rarity and how many more species are needed, or null when all are unlocked. */
  getNextUnlock,
  /** Species needed to unlock a rarity. */
  getRarityUnlockThreshold,
  /** The 25 slots (or one rarity's) with discovered flag and lifetime catch count. */
  getEncyclopediaEntries
} from "./encyclopediaService";
export type {
  /** One encyclopedia slot. */
  EncyclopediaEntry,
  /** A rarity or "all". */
  EncyclopediaFilter
} from "./encyclopediaService";

// --- Offline ------------------------------------------------------------------------------
export {
  /** Simulate the time away (cap 4h, 50% efficiency) catch by catch; moves lastOfflineSettlementAt forward only. */
  settleOffline,
  /** Just the arithmetic: elapsed/capped seconds and effective catch count. */
  calculateOfflineCatches
} from "./offlineService";

// --- Minigame (bobber timing) -------------------------------------------------------------
export {
  /** Start a round; the rng places the timing zone. */
  createTimingRound,
  /** Indicator position (0..1) at elapsed ms. */
  indicatorPosition,
  /** "perfect" | "success" | "miss" for a tap at elapsed ms (the first tap of a round is the one that counts). */
  evaluateTap,
  /** Register a tap: returns the updated round, the result and `counted` (false for every tap after the first). */
  tapRound,
  /** True once the round's one tap has been used. */
  hasTapped,
  /** True while elapsed ms is inside the timing window. */
  isWithinWindow,
  /** Fraction of the window used (0..1). */
  getRoundProgress,
  /** True when the countdown's remaining ms is inside the timing window (the last 3 s). */
  isMinigameWindowOpen,
  /** The result to pass to applyCatch: the tap result, or "none". */
  getRoundResult,
  /** Extra coins: min(cap, ceil(sellPrice x ratio)); 0 for miss / none. */
  computeMinigameBonus,
  /** Perfect +1; anything else resets the streak to 0. */
  applyMinigameStreak,
  /** Relative rare+ boost a streak gives (0 by default). */
  getStreakBonus
} from "./minigameService";
export type {
  /** One timing round (zones, window, first tap). */
  TimingRound
} from "./minigameService";

// --- Saving -------------------------------------------------------------------------------
export {
  /** A brand-new save. */
  createNewSave,
  /** Load: { status: 'none' } | { status:'loaded', save } | { status:'corrupt', backupKey, save: fresh }. Corrupt data is backed up, never overwritten. */
  loadFromLocalStorage,
  /** Write to localStorage (stamps lastSavedAt only). Never throws; returns { ok, save } or { ok:false, error }. */
  saveToLocalStorage,
  /** Pretty JSON for the export button. */
  exportSaveJson,
  /** Import: parse + migrate (v1, v2 -> v3) + validate, or throw an Error with a Chinese message. */
  parseImportedSave,
  /** Full validator for a v3 save. */
  validateSave,
  /** Human-readable list of what is wrong with a save (empty = valid). */
  getSaveValidationErrors,
  /** Upgrade an older save object (v1, v2) to v3. */
  migrateSave,
  /** Change sound / music / motion settings (volume is clamped to 0..1). */
  updateSettings,
  /** Heartbeat: advance lastOfflineSettlementAt to now, only if now is later (never backwards). */
  markActive,
  /** The localStorage key of the save. */
  SAVE_KEY,
  /** Prefix of the key a corrupt save is backed up to. */
  CORRUPT_SAVE_KEY_PREFIX
} from "./saveService";
export type {
  /** Result of loading. */
  LoadResult,
  /** Result of writing. */
  SaveWriteResult,
  /** Result of migrating. */
  MigrationResult
} from "./saveService";
