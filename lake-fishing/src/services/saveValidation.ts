import { EQUIPMENT } from "../data/equipment";
import { getFishById, isKnownFishId } from "../data/fish";
import { CURRENT_SAVE_VERSION } from "../types/game";
import type { EquipmentType, GameSave } from "../types/game";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Integer >= 0 within the safe range. */
export const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/** Finite number >= 0 (timestamps). */
const isTimestamp = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

/**
 * Every problem found in a v2 save, as short English strings (empty = valid). Checks types,
 * ranges (equipment levels, volume, non-negative integers), that every fish id is a known fish,
 * unique inventory ids, and cross-field consistency (counted fish must be discovered, inventory
 * holds only rare+ fish, total catches >= sum of per-species catches).
 */
export function getSaveValidationErrors(input: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(input)) return ["save is not an object"];

  if (input.saveVersion !== CURRENT_SAVE_VERSION) {
    errors.push(`saveVersion must be ${CURRENT_SAVE_VERSION}`);
  }
  for (const key of ["createdAt", "lastSavedAt", "lastActiveAt"] as const) {
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

  // Inventory
  if (!Array.isArray(input.inventory)) {
    errors.push("inventory must be an array");
  } else {
    const ids = new Set<string>();
    input.inventory.forEach((item: unknown, index: number) => {
      if (!isRecord(item)) {
        errors.push(`inventory[${index}] must be an object`);
        return;
      }
      if (typeof item.id !== "string" || item.id === "") errors.push(`inventory[${index}].id must be a non-empty string`);
      else if (ids.has(item.id)) errors.push(`inventory has duplicate id: ${item.id}`);
      else ids.add(item.id);
      const fish = typeof item.fishId === "string" ? getFishById(item.fishId) : undefined;
      if (!fish) errors.push(`inventory[${index}].fishId is not a known fish`);
      else {
        if (fish.autoSell) errors.push(`inventory[${index}] holds an auto-sell fish`);
        if (!discovered.has(fish.id)) errors.push(`inventory[${index}] fish is not discovered`);
      }
      if (typeof item.perfect !== "boolean") errors.push(`inventory[${index}].perfect must be a boolean`);
      if (!isTimestamp(item.caughtAt)) errors.push(`inventory[${index}].caughtAt must be a finite non-negative number`);
    });
  }
  if (!isCount(input.nextInventoryId)) errors.push("nextInventoryId must be a non-negative integer");

  // Pity & stats
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

  // Settings
  if (!isRecord(input.settings)) {
    errors.push("settings must be an object");
  } else {
    if (typeof input.settings.musicEnabled !== "boolean") errors.push("settings.musicEnabled must be a boolean");
    if (typeof input.settings.reducedMotion !== "boolean") errors.push("settings.reducedMotion must be a boolean");
    const volume = input.settings.musicVolume;
    if (typeof volume !== "number" || !Number.isFinite(volume) || volume < 0 || volume > 1) {
      errors.push("settings.musicVolume must be a number 0..1");
    }
  }

  return errors;
}

/** Full structural and semantic validation of a current-version (v2) save. */
export function validateSave(input: unknown): input is GameSave {
  return getSaveValidationErrors(input).length === 0;
}
