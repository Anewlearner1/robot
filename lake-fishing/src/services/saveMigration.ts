import { EQUIPMENT } from "../data/equipment";
import { getFishById, LEGACY_FISH_ID_MAP } from "../data/fish";
import { CURRENT_SAVE_VERSION } from "../types/game";
import type { EquipmentType, GameSave } from "../types/game";
import { calculateSalePrice } from "./economyService";
import { isCount } from "./saveValidation";

export type MigrationResult =
  | { ok: true; save: GameSave; migratedFrom: number | null }
  | { ok: false; reason: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isTimestamp = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

/** Upper bound for a single v1 stack so a tampered file cannot allocate millions of items. */
const MAX_V1_STACK = 10_000;

const renameFishId = (id: string) => LEGACY_FISH_ID_MAP[id] ?? id;

/**
 * v1 -> v2.
 * - fish id `fish_cultrure` -> `fish_xenocypris` everywhere; unknown discovered ids are dropped;
 * - lastOfflineSettlementAt -> lastActiveAt;
 * - v1 `fishInventory` / `pendingFish` stacks: rare+ fish become inventory items (not perfect,
 *   caughtAt = lastSavedAt), common/uncommon stacks are sold at current prices;
 * - catchCounts is rebuilt (every discovered fish counts at least 1, plus carried stacks);
 * - settings.soundEnabled -> musicEnabled, musicVolume = 0.5.
 * Returns an error reason when the v1 data is structurally broken.
 */
function migrateV1(input: Record<string, unknown>): MigrationResult {
  const fail = (reason: string): MigrationResult => ({ ok: false, reason: `v1: ${reason}` });
  const { equipmentLevels, stats, settings, pity } = input;
  if (!isCount(input.coins)) return fail("coins");
  for (const key of ["createdAt", "lastSavedAt", "lastOfflineSettlementAt"] as const) {
    if (!isTimestamp(input[key])) return fail(key);
  }
  if (!isRecord(equipmentLevels)) return fail("equipmentLevels");
  const levels = {} as Record<EquipmentType, number>;
  for (const equipment of EQUIPMENT) {
    const level = equipmentLevels[equipment.id];
    if (!Number.isInteger(level) || (level as number) < 1 || (level as number) > equipment.maxLevel) {
      return fail(`equipmentLevels.${equipment.id}`);
    }
    levels[equipment.id] = level as number;
  }
  if (!Array.isArray(input.discoveredFishIds) || !input.discoveredFishIds.every((id) => typeof id === "string")) {
    return fail("discoveredFishIds");
  }
  if (!isRecord(pity) || !isCount(pity.consecutiveNonLegendary)) return fail("pity");
  if (!isRecord(stats) || !isCount(stats.totalCatches) || !isCount(stats.totalFishSold) || !isCount(stats.totalCoinsEarned)) {
    return fail("stats");
  }
  const soundEnabled = isRecord(settings) && typeof settings.soundEnabled === "boolean" ? settings.soundEnabled : true;
  const reducedMotion = isRecord(settings) && typeof settings.reducedMotion === "boolean" ? settings.reducedMotion : false;

  // Stacks carried over from the (never populated, but allowed) v1 inventory fields.
  const stacks: { fishId: string; quantity: number; caughtAt: number }[] = [];
  const fishInventory = input.fishInventory;
  if (fishInventory !== undefined) {
    if (!isRecord(fishInventory)) return fail("fishInventory");
    for (const [id, quantity] of Object.entries(fishInventory)) {
      if (!isCount(quantity) || quantity > MAX_V1_STACK) return fail(`fishInventory.${id}`);
      stacks.push({ fishId: renameFishId(id), quantity, caughtAt: input.lastSavedAt as number });
    }
  }
  const pendingFish = input.pendingFish;
  if (pendingFish !== undefined) {
    if (!Array.isArray(pendingFish)) return fail("pendingFish");
    for (const entry of pendingFish) {
      if (!isRecord(entry) || typeof entry.fishId !== "string" || !isCount(entry.quantity) || entry.quantity > MAX_V1_STACK) {
        return fail("pendingFish entry");
      }
      stacks.push({
        fishId: renameFishId(entry.fishId),
        quantity: entry.quantity,
        caughtAt: isTimestamp(entry.caughtAt) ? entry.caughtAt : (input.lastSavedAt as number)
      });
    }
  }

  const discovered: string[] = [];
  for (const raw of input.discoveredFishIds as string[]) {
    const id = renameFishId(raw);
    if (getFishById(id) && !discovered.includes(id)) discovered.push(id);
  }

  const stackCounts: Record<string, number> = {};

  let coins = input.coins;
  let totalFishSold = stats.totalFishSold;
  let totalCoinsEarned = stats.totalCoinsEarned;
  const inventory: GameSave["inventory"] = [];
  let nextInventoryId = 0;
  for (const stack of stacks) {
    const fish = getFishById(stack.fishId);
    if (!fish || stack.quantity === 0) continue; // unknown fish: nothing sensible to keep
    if (!discovered.includes(fish.id)) discovered.push(fish.id);
    stackCounts[fish.id] = (stackCounts[fish.id] ?? 0) + stack.quantity;
    if (fish.autoSell) {
      const value = calculateSalePrice(fish, levels.bait) * stack.quantity;
      coins += value;
      totalCoinsEarned += value;
      totalFishSold += stack.quantity;
    } else {
      for (let i = 0; i < stack.quantity; i++) {
        inventory.push({ id: `item_${nextInventoryId++}`, fishId: fish.id, perfect: false, caughtAt: stack.caughtAt });
      }
    }
  }

  // Every discovered fish was caught at least once; carried stacks may imply more.
  const catchCounts: Record<string, number> = {};
  for (const id of discovered) catchCounts[id] = Math.max(1, stackCounts[id] ?? 0);

  const countSum = Object.values(catchCounts).reduce((sum, count) => sum + count, 0);
  const save: GameSave = {
    saveVersion: CURRENT_SAVE_VERSION,
    createdAt: input.createdAt as number,
    lastSavedAt: input.lastSavedAt as number,
    lastActiveAt: input.lastOfflineSettlementAt as number,
    coins,
    equipmentLevels: levels,
    discoveredFishIds: discovered,
    catchCounts,
    inventory,
    nextInventoryId,
    pity: { consecutiveNonLegendary: pity.consecutiveNonLegendary },
    stats: {
      totalCatches: Math.max(stats.totalCatches, countSum),
      totalFishSold,
      totalCoinsEarned
    },
    settings: { musicEnabled: soundEnabled, musicVolume: 0.5, reducedMotion }
  };
  return { ok: true, save, migratedFrom: 1 };
}

/**
 * Bring any stored save up to the current version. v2 passes through untouched (validate it
 * with `validateSave`); v1 is migrated; anything else is rejected with a reason.
 * The migrated result is NOT validated here; callers run `validateSave` on `save`.
 */
export function migrateSave(input: unknown): MigrationResult {
  if (!isRecord(input)) return { ok: false, reason: "save is not an object" };
  switch (input.saveVersion) {
    case 1:
      return migrateV1(input);
    case CURRENT_SAVE_VERSION:
      return { ok: true, save: input as unknown as GameSave, migratedFrom: null };
    default:
      return { ok: false, reason: `unsupported saveVersion: ${String(input.saveVersion)}` };
  }
}
