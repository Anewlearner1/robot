import { getFishById, FISH } from "../data/fish";
import type {
  CatchEvent,
  CatchSource,
  FishDefinition,
  GameSave,
  MinigameOutcome,
  PendingFish
} from "../types/game";
import { getSalePrice } from "./economyService";
import { getKnownDiscoveredIds } from "./encyclopediaService";
import { GameLogicError } from "./errors";
import { getUnlockedRarities } from "./fishingService";
import { applyMinigameStreak, computeMinigameBonus } from "./minigameService";
import { assertValidFish } from "./validationService";

function requireFish(fishId: string): FishDefinition {
  const fish = getFishById(fishId);
  if (!fish) throw new GameLogicError("UNKNOWN_FISH_ID", `Unknown fish id: ${fishId}`);
  assertValidFish(fish);
  return fish;
}

function mintPendingId(save: Pick<GameSave, "pendingFish" | "nextPendingId">): { id: string; next: number } {
  const taken = new Set(save.pendingFish.map((entry) => entry.id));
  let n = save.nextPendingId;
  while (taken.has(`pending_${n}`)) n++;
  return { id: `pending_${n}`, next: n + 1 };
}

export interface ApplyCatchOptions {
  /** Where the catch came from: "active" (timer), "minigame" (the player tapped), or "offline". */
  source: CatchSource;
  /** Timestamp of the catch (ms). */
  now: number;
  /**
   * The bobber-timing result of this catch. When given: a success / perfect pays the bonus coins
   * (on top of the sale price), and the perfect streak is updated (perfect +1, anything else
   * resets it). When omitted (e.g. offline), no bonus is paid and the streak is left alone.
   */
  minigame?: MinigameOutcome;
}

/**
 * Resolve one caught fish. Returns a new save (the input is never mutated) and an event:
 * - common/uncommon: sold at once for exactly `sellPrice` (no multipliers);
 * - rare and above: added to `pendingFish` (same fish + same source merge into one row);
 * - minigame bonus coins (see `computeMinigameBonus`) are paid on top and counted in
 *   `stats.totalCoinsEarned`; a miss / no tap pays and loses nothing;
 * - the first catch of a species is registered in the encyclopedia;
 * - pity: +1 for a non-legendary catch only if legendary was already unlocked before this
 *   catch, reset to 0 on a legendary.
 * Throws `GameLogicError("UNKNOWN_FISH_ID")` for an id that is not in the catalogue and
 * `GameLogicError("INVALID_FISH_DATA")` for a catalogue entry with a bad rarity / price / flag,
 * before anything is computed.
 */
export function applyCatch(
  save: GameSave,
  fishId: string,
  opts: ApplyCatchOptions
): { save: GameSave; event: CatchEvent } {
  const fish = requireFish(fishId);
  const known = getKnownDiscoveredIds(save.discoveredFishIds);
  const isNewDiscovery = !known.includes(fish.id);
  const discoveredFishIds = isNewDiscovery ? [...known, fish.id] : known;

  const unlockedBefore = getUnlockedRarities(known);
  const unlockedAfter = isNewDiscovery ? getUnlockedRarities(discoveredFishIds) : unlockedBefore;
  const newlyUnlockedRarities = unlockedAfter.filter((rarity) => !unlockedBefore.includes(rarity));

  const pityBefore = save.pity.consecutiveNonLegendary;
  const reset = fish.rarity === "legendary";
  const pityAfter = reset ? 0 : unlockedBefore.includes("legendary") ? pityBefore + 1 : pityBefore;

  const speciesCatchCount = (save.catchCounts[fish.id] ?? 0) + 1;
  const minigameResult = opts.minigame ? opts.minigame.result : null;
  const bonusCoins = minigameResult ? computeMinigameBonus(fish, minigameResult) : 0;
  const streakSave = minigameResult ? applyMinigameStreak(save, minigameResult) : save;

  let next: GameSave = {
    ...streakSave,
    discoveredFishIds,
    catchCounts: { ...save.catchCounts, [fish.id]: speciesCatchCount },
    pity: { consecutiveNonLegendary: pityAfter },
    stats: { ...save.stats, totalCatches: save.stats.totalCatches + 1 }
  };

  let saleCoins = 0;
  let pendingFish: PendingFish | null = null;
  if (fish.autoSell) {
    saleCoins = getSalePrice(fish);
    next = { ...next, stats: { ...next.stats, totalFishSold: next.stats.totalFishSold + 1 } };
  } else {
    const existing = next.pendingFish.findIndex(
      (entry) => entry.fishId === fish.id && entry.source === opts.source
    );
    if (existing >= 0) {
      const row = next.pendingFish[existing];
      pendingFish = { ...row, quantity: row.quantity + 1, caughtAt: Math.max(row.caughtAt, opts.now) };
      const rows = next.pendingFish.slice();
      rows[existing] = pendingFish;
      next = { ...next, pendingFish: rows };
    } else {
      const { id, next: nextPendingId } = mintPendingId(next);
      pendingFish = { id, fishId: fish.id, quantity: 1, caughtAt: opts.now, source: opts.source };
      next = { ...next, pendingFish: [...next.pendingFish, pendingFish], nextPendingId };
    }
  }

  const coinsEarned = saleCoins + bonusCoins;
  if (coinsEarned > 0) {
    next = {
      ...next,
      coins: next.coins + coinsEarned,
      stats: { ...next.stats, totalCoinsEarned: next.stats.totalCoinsEarned + coinsEarned }
    };
  }

  return {
    save: next,
    event: {
      fishId: fish.id,
      rarity: fish.rarity,
      caughtAt: opts.now,
      source: opts.source,
      outcome: fish.autoSell ? "sold" : "pending",
      coinsEarned,
      saleCoins,
      bonusCoins,
      minigameResult,
      pendingFish,
      isNewDiscovery,
      newlyUnlockedRarities,
      pity: { before: pityBefore, after: pityAfter, reset },
      perfectStreak: { before: save.minigame.perfectStreak, after: next.minigame.perfectStreak },
      speciesCatchCount
    }
  };
}

// --- Queries for the backpack screen ------------------------------------------------------

/** Total value of everything in the pending list at sell prices. */
export function getPendingValue(save: Pick<GameSave, "pendingFish">): number {
  return save.pendingFish.reduce((sum, row) => {
    const fish = getFishById(row.fishId);
    return fish ? sum + getSalePrice(fish, row.quantity) : sum;
  }, 0);
}

/** Total value of the kept fish at sell prices. */
export function getInventoryValue(save: Pick<GameSave, "fishInventory">): number {
  return Object.entries(save.fishInventory).reduce((sum, [fishId, count]) => {
    const fish = getFishById(fishId);
    return fish ? sum + getSalePrice(fish, count) : sum;
  }, 0);
}

/** A pending row with its fish and prices, ready to display. */
export interface PendingEntry {
  pending: PendingFish;
  fish: FishDefinition;
  unitPrice: number;
  totalValue: number;
}

/** Pending rows in list order (unknown fish ids are skipped). */
export function getPendingEntries(save: Pick<GameSave, "pendingFish">): PendingEntry[] {
  const entries: PendingEntry[] = [];
  for (const pending of save.pendingFish) {
    const fish = getFishById(pending.fishId);
    if (fish) {
      entries.push({ pending, fish, unitPrice: getSalePrice(fish), totalValue: getSalePrice(fish, pending.quantity) });
    }
  }
  return entries;
}

/** A kept species with its count and prices, ready to display. */
export interface InventoryEntry {
  fish: FishDefinition;
  quantity: number;
  unitPrice: number;
  totalValue: number;
}

/** Kept fish in catalogue order (species with a count of 0 are skipped). */
export function getInventoryEntries(save: Pick<GameSave, "fishInventory">): InventoryEntry[] {
  return FISH.flatMap((fish) => {
    const quantity = save.fishInventory[fish.id] ?? 0;
    return quantity > 0
      ? [{ fish, quantity, unitPrice: getSalePrice(fish), totalValue: getSalePrice(fish, quantity) }]
      : [];
  });
}

// --- Selling and keeping ------------------------------------------------------------------

/** Why a sell / keep request was refused. The save is returned unchanged. */
export type TradeFailureReason =
  /** No such pending row / the fish is not in the backpack (also: already sold, double click). */
  | "NOT_FOUND"
  /** The quantity is not a positive integer. */
  | "INVALID_QUANTITY"
  /** More requested than held. */
  | "INSUFFICIENT_QUANTITY"
  /** The row refers to a fish that does not exist. */
  | "UNKNOWN_FISH"
  /** A sell-all on an empty list. */
  | "NOTHING_TO_SELL"
  /** The coin total would leave the safe integer range. */
  | "OVERFLOW";

export type SellResult =
  | { ok: true; save: GameSave; fishId: string; soldCount: number; coinsEarned: number }
  | { ok: false; reason: TradeFailureReason; save: GameSave };

export type KeepResult =
  | { ok: true; save: GameSave; fishId: string; keptCount: number }
  | { ok: false; reason: TradeFailureReason; save: GameSave };

export type SellAllResult =
  | { ok: true; save: GameSave; soldCount: number; coinsEarned: number }
  | { ok: false; reason: TradeFailureReason; save: GameSave };

const isPositiveInt = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;

/** Credit a sale to the save: coins, totalFishSold, totalCoinsEarned. The encyclopedia is untouched. */
function creditSale(save: GameSave, soldCount: number, coinsEarned: number): GameSave | null {
  const coins = save.coins + coinsEarned;
  const earned = save.stats.totalCoinsEarned + coinsEarned;
  if (!Number.isSafeInteger(coins) || !Number.isSafeInteger(earned)) return null;
  return {
    ...save,
    coins,
    stats: { ...save.stats, totalFishSold: save.stats.totalFishSold + soldCount, totalCoinsEarned: earned }
  };
}

function withoutRowOrReduced(rows: PendingFish[], index: number, quantity: number): PendingFish[] {
  const row = rows[index];
  if (quantity >= row.quantity) return rows.filter((_, i) => i !== index);
  const next = rows.slice();
  next[index] = { ...row, quantity: row.quantity - quantity };
  return next;
}

/**
 * Sell `qty` fish (default: the whole row) from one pending row at `sellPrice` each. Verifies
 * the quantity held; on any problem returns `{ ok: false, reason }` and the unchanged save, so
 * a double click can never sell twice. Updates coins and stats; the encyclopedia is untouched.
 */
export function sellPending(save: GameSave, pendingId: string, qty?: number): SellResult {
  const index = save.pendingFish.findIndex((row) => row.id === pendingId);
  if (index < 0) return { ok: false, reason: "NOT_FOUND", save };
  const row = save.pendingFish[index];
  const quantity = qty ?? row.quantity;
  if (!isPositiveInt(quantity)) return { ok: false, reason: "INVALID_QUANTITY", save };
  if (!isPositiveInt(row.quantity) || quantity > row.quantity) return { ok: false, reason: "INSUFFICIENT_QUANTITY", save };
  const fish = getFishById(row.fishId);
  if (!fish) return { ok: false, reason: "UNKNOWN_FISH", save };
  const coinsEarned = getSalePrice(fish, quantity);
  const credited = creditSale(save, quantity, coinsEarned);
  if (!credited) return { ok: false, reason: "OVERFLOW", save };
  return {
    ok: true,
    fishId: fish.id,
    soldCount: quantity,
    coinsEarned,
    save: { ...credited, pendingFish: withoutRowOrReduced(save.pendingFish, index, quantity) }
  };
}

/**
 * Keep `qty` fish (default: the whole row) from one pending row: they move into `fishInventory`
 * (no coins). Same validation and failure behaviour as `sellPending`.
 */
export function keepPending(save: GameSave, pendingId: string, qty?: number): KeepResult {
  const index = save.pendingFish.findIndex((row) => row.id === pendingId);
  if (index < 0) return { ok: false, reason: "NOT_FOUND", save };
  const row = save.pendingFish[index];
  const quantity = qty ?? row.quantity;
  if (!isPositiveInt(quantity)) return { ok: false, reason: "INVALID_QUANTITY", save };
  if (!isPositiveInt(row.quantity) || quantity > row.quantity) return { ok: false, reason: "INSUFFICIENT_QUANTITY", save };
  const fish = getFishById(row.fishId);
  if (!fish) return { ok: false, reason: "UNKNOWN_FISH", save };
  const held = (save.fishInventory[fish.id] ?? 0) + quantity;
  if (!Number.isSafeInteger(held)) return { ok: false, reason: "OVERFLOW", save };
  return {
    ok: true,
    fishId: fish.id,
    keptCount: quantity,
    save: {
      ...save,
      fishInventory: { ...save.fishInventory, [fish.id]: held },
      pendingFish: withoutRowOrReduced(save.pendingFish, index, quantity)
    }
  };
}

/**
 * Sell `qty` kept fish of one species at `sellPrice` each. `qty` must be a positive integer not
 * above the count held; otherwise `{ ok: false, reason }` and the unchanged save.
 */
export function sellInventoryFish(save: GameSave, fishId: string, qty: number): SellResult {
  const fish = getFishById(fishId);
  if (!fish) return { ok: false, reason: "UNKNOWN_FISH", save };
  const held = Object.prototype.hasOwnProperty.call(save.fishInventory, fishId) ? save.fishInventory[fishId] : 0;
  if (!(held > 0)) return { ok: false, reason: "NOT_FOUND", save };
  if (!isPositiveInt(qty)) return { ok: false, reason: "INVALID_QUANTITY", save };
  if (qty > held) return { ok: false, reason: "INSUFFICIENT_QUANTITY", save };
  const coinsEarned = getSalePrice(fish, qty);
  const credited = creditSale(save, qty, coinsEarned);
  if (!credited) return { ok: false, reason: "OVERFLOW", save };
  const inventory = { ...save.fishInventory };
  if (qty === held) delete inventory[fishId];
  else inventory[fishId] = held - qty;
  return { ok: true, fishId, soldCount: qty, coinsEarned, save: { ...credited, fishInventory: inventory } };
}

/** Sell the whole pending list. The UI should ask for confirmation first. */
export function sellAllPending(save: GameSave): SellAllResult {
  const soldCount = save.pendingFish.reduce((sum, row) => sum + (getFishById(row.fishId) ? row.quantity : 0), 0);
  if (soldCount === 0) return { ok: false, reason: "NOTHING_TO_SELL", save };
  const coinsEarned = getPendingValue(save);
  const credited = creditSale(save, soldCount, coinsEarned);
  if (!credited) return { ok: false, reason: "OVERFLOW", save };
  return {
    ok: true,
    soldCount,
    coinsEarned,
    save: { ...credited, pendingFish: save.pendingFish.filter((row) => !getFishById(row.fishId)) }
  };
}

/** Sell every kept fish. The UI should ask for confirmation first. */
export function sellAllInventory(save: GameSave): SellAllResult {
  const known = Object.entries(save.fishInventory).filter(([id, count]) => getFishById(id) && count > 0);
  const soldCount = known.reduce((sum, [, count]) => sum + count, 0);
  if (soldCount === 0) return { ok: false, reason: "NOTHING_TO_SELL", save };
  const coinsEarned = getInventoryValue(save);
  const credited = creditSale(save, soldCount, coinsEarned);
  if (!credited) return { ok: false, reason: "OVERFLOW", save };
  const remaining = Object.fromEntries(Object.entries(save.fishInventory).filter(([id]) => !getFishById(id)));
  return { ok: true, soldCount, coinsEarned, save: { ...credited, fishInventory: remaining } };
}
