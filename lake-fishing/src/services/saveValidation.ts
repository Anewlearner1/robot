import { EQUIPMENT } from "../data/equipment";
import { getFishById, isKnownFishId } from "../data/fish";
import { CURRENT_SAVE_VERSION } from "../types/game";
import type { CatchSource, EquipmentType, GameSave } from "../types/game";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Integer >= 0 within the safe range. */
export const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/** Finite number >= 0 (timestamps). */
const isTimestamp = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

/** The allowed values of `PendingFish.source`. */
export const CATCH_SOURCES: readonly CatchSource[] = ["active", "offline", "minigame"];

export const isCatchSource = (value: unknown): value is CatchSource =>
  typeof value === "string" && (CATCH_SOURCES as readonly string[]).includes(value);

/**
 * Every problem found in a v3 save, as short English strings (empty = valid). Checks types,
 * ranges (equipment levels, volume, non-negative integers, positive pending quantities), that
 * every fish id is a known fish, unique pending ids, de-duplicated discovered ids, and
 * cross-field consistency (counted / held fish must be discovered, held fish are rare+, total
 * catches >= sum of per-species catches).
 */
export function getSaveValidationErrors(input: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(input)) return ["save is not an object"];

  if (input.saveVersion !== CURRENT_SAVE_VERSION) {
    errors.push(`saveVersion must be ${CURRENT_SAVE_VERSION}`);
  }
  for (const key of ["createdAt", "lastSavedAt", "lastOfflineSettlementAt"] as const) {
    if (!isTimestamp(input[key])) errors.push(`${key} must be a finite non-negative number`);
  }
  if (!isCount(input.coins)) errors.push("coins must be a non-negative integer");

  // Equipment
  if (!isRecord(input.equipmentLevels)) {
    errors.push("equipmentLevels must be an object");
  } else {
    for (const equipment of EQUIPMENT) {
      const level = input.equipmentLevels[equipment.id as EquipmentType];
      if (!Number.isInteger(level) || (level as number) < 1 || (level as number) > equipment.maxLevel) {
        errors.push(`equipmentLevels.${equipment.id} must be an integer 1..${equipment.maxLevel}`);
      }
    }
  }

  // Encyclopedia
  const discovered = new Set<string>();
  if (!Array.isArray(input.discoveredFishIds)) {
    errors.push("discoveredFishIds must be an array");
  } else {
    for (const id of input.discoveredFishIds) {
      if (!isKnownFishId(id)) errors.push(`discoveredFishIds has unknown fish id: ${String(id)}`);
      else if (discovered.has(id)) errors.push(`discoveredFishIds has duplicate: ${id}`);
      else discovered.add(id);
    }
  }

  let countSum = 0;
  if (!isRecord(input.catchCounts)) {
    errors.push("catchCounts must be an object");
  } else {
    for (const [id, count] of Object.entries(input.catchCounts)) {
      if (!isKnownFishId(id)) {
        errors.push(`catchCounts has unknown fish id: ${id}`);
      } else if (!isCount(count) || count < 1) {
        errors.push(`catchCounts.${id} must be a positive integer`);
      } else {
        countSum += count;
        if (!discovered.has(id)) errors.push(`catchCounts.${id} is not in discoveredFishIds`);
      }
    }
  }

  // Kept fish
  if (!isRecord(input.fishInventory)) {
    errors.push("fishInventory must be an object");
  } else {
    for (const [id, count] of Object.entries(input.fishInventory)) {
      const fish = getFishById(id);
      if (!fish) {
        errors.push(`fishInventory has unknown fish id: ${id}`);
      } else if (!isCount(count)) {
        errors.push(`fishInventory.${id} must be a non-negative integer`);
      } else if (count > 0) {
        if (fish.autoSell) errors.push(`fishInventory.${id} holds an auto-sell fish`);
        if (!discovered.has(id)) errors.push(`fishInventory.${id} is not in discoveredFishIds`);
      }
    }
  }

  // Pending fish
  if (!Array.isArray(input.pendingFish)) {
    errors.push("pendingFish must be an array");
  } else {
    const ids = new Set<string>();
    input.pendingFish.forEach((row: unknown, index: number) => {
      if (!isRecord(row)) {
        errors.push(`pendingFish[${index}] must be an object`);
        return;
      }
      if (typeof row.id !== "string" || row.id === "") errors.push(`pendingFish[${index}].id must be a non-empty string`);
      else if (ids.has(row.id)) errors.push(`pendingFish has duplicate id: ${row.id}`);
      else ids.add(row.id);
      const fish = typeof row.fishId === "string" ? getFishById(row.fishId) : undefined;
      if (!fish) errors.push(`pendingFish[${index}].fishId is not a known fish`);
      else {
        if (fish.autoSell) errors.push(`pendingFish[${index}] holds an auto-sell fish`);
        if (!discovered.has(fish.id)) errors.push(`pendingFish[${index}] fish is not discovered`);
      }
      if (!isCount(row.quantity) || row.quantity < 1) errors.push(`pendingFish[${index}].quantity must be a positive integer`);
      if (!isTimestamp(row.caughtAt)) errors.push(`pendingFish[${index}].caughtAt must be a finite non-negative number`);
      if (!isCatchSource(row.source)) errors.push(`pendingFish[${index}].source must be one of ${CATCH_SOURCES.join("|")}`);
    });
  }
  if (!isCount(input.nextPendingId)) errors.push("nextPendingId must be a non-negative integer");

  // Pity, stats & minigame
  if (!isRecord(input.pity) || !isCount(input.pity.consecutiveNonLegendary)) {
    errors.push("pity.consecutiveNonLegendary must be a non-negative integer");
  }
  if (!isRecord(input.stats)) {
    errors.push("stats must be an object");
  } else {
    for (const key of ["totalCatches", "totalFishSold", "totalCoinsEarned"] as const) {
      if (!isCount(input.stats[key])) errors.push(`stats.${key} must be a non-negative integer`);
    }
    if (isCount(input.stats.totalCatches) && input.stats.totalCatches < countSum) {
      errors.push("stats.totalCatches is smaller than the sum of catchCounts");
    }
  }
  if (!isRecord(input.minigame) || !isCount(input.minigame.perfectStreak)) {
    errors.push("minigame.perfectStreak must be a non-negative integer");
  }

  // Settings
  if (!isRecord(input.settings)) {
    errors.push("settings must be an object");
  } else {
    for (const key of ["soundEnabled", "musicEnabled", "reducedMotion"] as const) {
      if (typeof input.settings[key] !== "boolean") errors.push(`settings.${key} must be a boolean`);
    }
    const volume = input.settings.musicVolume;
    if (typeof volume !== "number" || !Number.isFinite(volume) || volume < 0 || volume > 1) {
      errors.push("settings.musicVolume must be a number 0..1");
    }
  }

  return errors;
}

/** Full structural and semantic validation of a current-version (v3) save. */
export function validateSave(input: unknown): input is GameSave {
  return getSaveValidationErrors(input).length === 0;
}
