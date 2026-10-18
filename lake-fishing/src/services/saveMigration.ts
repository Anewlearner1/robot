import { EQUIPMENT } from "../data/equipment";
import { getFishById, LEGACY_FISH_ID_MAP } from "../data/fish";
import { CURRENT_SAVE_VERSION } from "../types/game";
import type { CatchSource, EquipmentType, GameSave, PendingFish } from "../types/game";
import { getSalePrice } from "./economyService";
import { isCatchSource, isCount } from "./saveValidation";

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

/** Builds pending rows, merging entries of the same fish + source; ids are minted in order. */
function createPendingBuilder() {
  const rows: PendingFish[] = [];
  return {
    add(fishId: string, quantity: number, caughtAt: number, source: CatchSource) {
      const existing = rows.find((row) => row.fishId === fishId && row.source === source);
      if (existing) {
        existing.quantity += quantity;
        existing.caughtAt = Math.max(existing.caughtAt, caughtAt);
      } else {
        rows.push({ id: `pending_${rows.length}`, fishId, quantity, caughtAt, source });
      }
    },
    rows
  };
}

/**
 * v1 -> v3 (v1 = the PRD-shaped first build).
 * - fish id `fish_cultrure` -> `fish_xenocypris` everywhere; unknown discovered ids are dropped;
 * - `lastOfflineSettlementAt` is kept as is;
 * - v1 `fishInventory` stacks of rare+ fish stay in `fishInventory`; `pendingFish` rows stay in
 *   `pendingFish` (same fish + same source merge); common/uncommon stacks are sold at sellPrice;
 * - catchCounts is rebuilt (every discovered fish counts at least 1, plus carried stacks);
 * - `settings.soundEnabled` is kept and also seeds `musicEnabled`; musicVolume = 0.5.
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
  const lastSavedAt = input.lastSavedAt as number;

  const kept: { fishId: string; quantity: number }[] = [];
  const fishInventory = input.fishInventory;
  if (fishInventory !== undefined) {
    if (!isRecord(fishInventory)) return fail("fishInventory");
    for (const [id, quantity] of Object.entries(fishInventory)) {
      if (!isCount(quantity) || quantity > MAX_V1_STACK) return fail(`fishInventory.${id}`);
      kept.push({ fishId: renameFishId(id), quantity });
    }
  }
  const pending: { fishId: string; quantity: number; caughtAt: number; source: CatchSource }[] = [];
  const pendingFish = input.pendingFish;
  if (pendingFish !== undefined) {
    if (!Array.isArray(pendingFish)) return fail("pendingFish");
    for (const entry of pendingFish) {
      if (!isRecord(entry) || typeof entry.fishId !== "string" || !isCount(entry.quantity) || entry.quantity > MAX_V1_STACK) {
        return fail("pendingFish entry");
      }
      pending.push({
        fishId: renameFishId(entry.fishId),
        quantity: entry.quantity,
        caughtAt: isTimestamp(entry.caughtAt) ? entry.caughtAt : lastSavedAt,
        source: isCatchSource(entry.source) ? entry.source : "active"
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
  const inventory: Record<string, number> = {};
  const pendingBuilder = createPendingBuilder();

  const carry = (fishId: string, quantity: number, place: (fishId: string) => void) => {
    const fish = getFishById(fishId);
    if (!fish || quantity === 0) return; // unknown fish: nothing sensible to keep
    if (!discovered.includes(fish.id)) discovered.push(fish.id);
    stackCounts[fish.id] = (stackCounts[fish.id] ?? 0) + quantity;
    if (fish.autoSell) {
      const value = getSalePrice(fish, quantity);
      coins += value;
      totalCoinsEarned += value;
      totalFishSold += quantity;
    } else {
      place(fish.id);
    }
  };
  for (const stack of kept) {
    carry(stack.fishId, stack.quantity, (id) => {
      inventory[id] = (inventory[id] ?? 0) + stack.quantity;
    });
  }
  for (const row of pending) {
    carry(row.fishId, row.quantity, (id) => pendingBuilder.add(id, row.quantity, row.caughtAt, row.source));
  }

  // Every discovered fish was caught at least once; carried stacks may imply more.
  const catchCounts: Record<string, number> = {};
  for (const id of discovered) catchCounts[id] = Math.max(1, stackCounts[id] ?? 0);

  const countSum = Object.values(catchCounts).reduce((sum, count) => sum + count, 0);
  const save: GameSave = {
    saveVersion: CURRENT_SAVE_VERSION,
    createdAt: input.createdAt as number,
    lastSavedAt,
    lastOfflineSettlementAt: input.lastOfflineSettlementAt as number,
    coins,
    equipmentLevels: levels,
    discoveredFishIds: discovered,
    catchCounts,
    fishInventory: inventory,
    pendingFish: pendingBuilder.rows,
    nextPendingId: pendingBuilder.rows.length,
    pity: { consecutiveNonLegendary: pity.consecutiveNonLegendary },
    stats: {
      totalCatches: Math.max(stats.totalCatches, countSum),
      totalFishSold,
      totalCoinsEarned
    },
    minigame: { perfectStreak: 0 },
    settings: { soundEnabled, musicEnabled: soundEnabled, musicVolume: 0.5, reducedMotion }
  };
  return { ok: true, save, migratedFrom: 1 };
}

/**
 * v2 -> v3.
 * - `inventory[]` (one item per fish, with a `perfect` flag) becomes `pendingFish`: items of the
 *   same fish merge into one row (source "active", caughtAt = latest); the `perfect` flag is
 *   dropped without compensation; `nextInventoryId` is dropped;
 * - `lastActiveAt` becomes `lastOfflineSettlementAt`;
 * - new fields: `fishInventory = {}`, `minigame.perfectStreak = 0`, `settings.soundEnabled = true`.
 * Only the structure needed to rebuild the save is checked here; value ranges and cross-field
 * rules are left to `validateSave`, which the callers run on the result.
 */
function migrateV2(input: Record<string, unknown>): MigrationResult {
  const fail = (reason: string): MigrationResult => ({ ok: false, reason: `v2: ${reason}` });
  const { settings, inventory } = input;
  if (!isRecord(settings)) return fail("settings");
  if (!Array.isArray(inventory)) return fail("inventory");
  if (!isTimestamp(input.lastActiveAt)) return fail("lastActiveAt");

  const pending = createPendingBuilder();
  for (const item of inventory) {
    if (!isRecord(item) || typeof item.fishId !== "string" || !getFishById(item.fishId) || !isTimestamp(item.caughtAt)) {
      return fail("inventory item");
    }
    pending.add(item.fishId, 1, item.caughtAt, "active");
  }

  const { inventory: _inventory, nextInventoryId: _next, lastActiveAt, ...rest } = input;
  void _inventory;
  void _next;
  const save = {
    ...rest,
    saveVersion: CURRENT_SAVE_VERSION,
    lastOfflineSettlementAt: lastActiveAt,
    fishInventory: {},
    pendingFish: pending.rows,
    nextPendingId: pending.rows.length,
    minigame: { perfectStreak: 0 },
    settings: { soundEnabled: true, ...settings }
  } as unknown as GameSave;
  return { ok: true, save, migratedFrom: 2 };
}

/**
 * Bring any stored save up to the current version (3). v3 passes through untouched (validate it
 * with `validateSave`); v1 and v2 are migrated; anything else is rejected with a reason.
 * The migrated result is NOT validated here; callers run `validateSave` on `save`.
 */
export function migrateSave(input: unknown): MigrationResult {
  if (!isRecord(input)) return { ok: false, reason: "save is not an object" };
  switch (input.saveVersion) {
    case 1:
      return migrateV1(input);
    case 2:
      return migrateV2(input);
    case CURRENT_SAVE_VERSION:
      return { ok: true, save: input as unknown as GameSave, migratedFrom: null };
    default:
      return { ok: false, reason: `unsupported saveVersion: ${String(input.saveVersion)}` };
  }
}
