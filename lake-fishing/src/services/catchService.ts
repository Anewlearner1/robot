import { getFishById } from "../data/fish";
import type { CatchEvent, FishDefinition, GameSave, InventoryItem } from "../types/game";
import { calculateSalePrice } from "./economyService";
import { getKnownDiscoveredIds } from "./encyclopediaService";
import { getUnlockedRarities } from "./fishingService";

function requireFish(fishId: string): FishDefinition {
  const fish = getFishById(fishId);
  if (!fish) throw new Error(`Unknown fish id: ${fishId}`);
  return fish;
}

function mintInventoryId(save: GameSave): { id: string; next: number } {
  const taken = new Set(save.inventory.map((item) => item.id));
  let n = save.nextInventoryId;
  while (taken.has(`item_${n}`)) n++;
  return { id: `item_${n}`, next: n + 1 };
}

export interface ApplyCatchOptions {
  /** Won the minigame. Only meaningful for rare+ fish; ignored for auto-sold fish. */
  perfect?: boolean;
  /** Timestamp of the catch (ms). */
  now: number;
}

/**
 * Resolve one caught fish. Returns a new save (the input is never mutated) and an event:
 * - common/uncommon: sold at once for sellPrice x bait multiplier;
 * - rare and above: added to the inventory with a unique id;
 * - first catch of a species is registered in the encyclopedia;
 * - pity: +1 for a non-legendary catch only if legendary was already unlocked before this
 *   catch, reset to 0 on a legendary.
 * Throws on an unknown fish id.
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
  const base: GameSave = {
    ...save,
    discoveredFishIds,
    catchCounts: { ...save.catchCounts, [fish.id]: speciesCatchCount },
    pity: { consecutiveNonLegendary: pityAfter },
    stats: { ...save.stats, totalCatches: save.stats.totalCatches + 1 }
  };

  let next: GameSave;
  let outcome: CatchEvent["outcome"];
  let coinsEarned = 0;
  let inventoryItem: InventoryItem | null = null;
  const perfect = !fish.autoSell && opts.perfect === true;

  if (fish.autoSell) {
    outcome = "sold";
    coinsEarned = calculateSalePrice(fish, save.equipmentLevels.bait);
    next = {
      ...base,
      coins: base.coins + coinsEarned,
      stats: {
        ...base.stats,
        totalFishSold: base.stats.totalFishSold + 1,
        totalCoinsEarned: base.stats.totalCoinsEarned + coinsEarned
      }
    };
  } else {
    outcome = "inventory";
    const { id, next: nextInventoryId } = mintInventoryId(save);
    inventoryItem = { id, fishId: fish.id, perfect, caughtAt: opts.now };
    next = { ...base, inventory: [...base.inventory, inventoryItem], nextInventoryId };
  }

  return {
    save: next,
    event: {
      fishId: fish.id,
      rarity: fish.rarity,
      caughtAt: opts.now,
      outcome,
      coinsEarned,
      inventoryItem,
      perfect,
      isNewDiscovery,
      newlyUnlockedRarities,
      pity: { before: pityBefore, after: pityAfter, reset },
      speciesCatchCount
    }
  };
}

/** What a backpack item sells for right now (current bait level, perfect bonus included). */
export function getInventoryItemPrice(save: Pick<GameSave, "equipmentLevels">, item: InventoryItem): number {
  return calculateSalePrice(requireFish(item.fishId), save.equipmentLevels.bait, item.perfect);
}

/** Total value of the whole backpack at current prices. */
export function getInventoryValue(save: Pick<GameSave, "equipmentLevels" | "inventory">): number {
  return save.inventory.reduce((sum, item) => sum + getInventoryItemPrice(save, item), 0);
}

export type SellItemResult =
  | { ok: true; save: GameSave; coinsEarned: number; item: InventoryItem }
  | { ok: false; reason: "NOT_FOUND"; save: GameSave };

/** Sell one backpack item by its instance id. */
export function sellInventoryItem(save: GameSave, itemId: string): SellItemResult {
  const item = save.inventory.find((entry) => entry.id === itemId);
  if (!item) return { ok: false, reason: "NOT_FOUND", save };
  const coinsEarned = getInventoryItemPrice(save, item);
  return {
    ok: true,
    coinsEarned,
    item,
    save: {
      ...save,
      coins: save.coins + coinsEarned,
      inventory: save.inventory.filter((entry) => entry.id !== itemId),
      stats: {
        ...save.stats,
        totalFishSold: save.stats.totalFishSold + 1,
        totalCoinsEarned: save.stats.totalCoinsEarned + coinsEarned
      }
    }
  };
}

export interface SellAllResult {
  save: GameSave;
  coinsEarned: number;
  soldCount: number;
}

/** Sell the entire backpack. The UI should ask for confirmation first. */
export function sellAllInventory(save: GameSave): SellAllResult {
  if (save.inventory.length === 0) return { save, coinsEarned: 0, soldCount: 0 };
  const coinsEarned = getInventoryValue(save);
  const soldCount = save.inventory.length;
  return {
    coinsEarned,
    soldCount,
    save: {
      ...save,
      coins: save.coins + coinsEarned,
      inventory: [],
      stats: {
        ...save.stats,
        totalFishSold: save.stats.totalFishSold + soldCount,
        totalCoinsEarned: save.stats.totalCoinsEarned + coinsEarned
      }
    }
  };
}
