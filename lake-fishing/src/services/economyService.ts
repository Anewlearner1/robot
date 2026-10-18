import {
  clampEquipmentLevel,
  getEquipmentDefinition,
  getEquipmentEffect,
  getEquipmentLevelConfig
} from "../data/equipment";
import { GAME_CONFIG } from "../data/gameConfig";
import type { EquipmentType, FishDefinition, GameSave } from "../types/game";

export interface UpgradeResult {
  success: boolean;
  reason?: "MAX_LEVEL" | "INSUFFICIENT_COINS" | "INVALID_LEVEL";
  coins: number;
  level: number;
}

export function tryUpgradeEquipment(
  equipmentType: EquipmentType,
  currentLevel: number,
  coins: number
): UpgradeResult {
  const equipment = getEquipmentDefinition(equipmentType);
  if (!Number.isInteger(currentLevel) || currentLevel < 1 || currentLevel > equipment.maxLevel) {
    return { success: false, reason: "INVALID_LEVEL", coins, level: currentLevel };
  }
  if (currentLevel >= equipment.maxLevel) {
    return { success: false, reason: "MAX_LEVEL", coins, level: currentLevel };
  }

  const nextLevel = equipment.levels[currentLevel];
  const cost = nextLevel?.upgradeCost;
  if (cost === null || cost === undefined) {
    return { success: false, reason: "INVALID_LEVEL", coins, level: currentLevel };
  }
  if (coins < cost) {
    return { success: false, reason: "INSUFFICIENT_COINS", coins, level: currentLevel };
  }
  return { success: true, coins: coins - cost, level: currentLevel + 1 };
}

/** Apply `tryUpgradeEquipment` to a save. The returned save is unchanged when the upgrade fails. */
export function upgradeEquipment(
  save: GameSave,
  equipmentType: EquipmentType
): { save: GameSave; result: UpgradeResult } {
  const result = tryUpgradeEquipment(equipmentType, save.equipmentLevels[equipmentType], save.coins);
  if (!result.success) return { save, result };
  return {
    save: {
      ...save,
      coins: result.coins,
      equipmentLevels: { ...save.equipmentLevels, [equipmentType]: result.level }
    },
    result
  };
}

export interface EquipmentUpgradeInfo {
  type: EquipmentType;
  name: string;
  description: string;
  level: number;
  maxLevel: number;
  isMaxLevel: boolean;
  /** Raw effect values: rod = interval multiplier, line = rarity shift, bait = sell multiplier. */
  currentEffect: number;
  nextEffect: number | null;
  /** Ready-to-display Traditional Chinese text, e.g. "間隔 ×0.92（83 秒）". */
  currentEffectText: string;
  nextEffectText: string | null;
  /** Coins needed for the next level; null at max level. */
  cost: number | null;
  canAfford: boolean;
}

function describeEffect(type: EquipmentType, effect: number): string {
  switch (type) {
    case "rod": {
      const seconds = Math.max(
        GAME_CONFIG.minimumFishingIntervalSeconds,
        Math.round(GAME_CONFIG.baseFishingIntervalSeconds * effect)
      );
      return `間隔 ×${effect.toFixed(2)}（${seconds} 秒）`;
    }
    case "line":
      return effect === 0 ? "無加成" : `${Math.round(effect * 100)}% 機會改釣更稀有的魚`;
    case "bait":
      return `賣價 ×${effect.toFixed(2)}`;
  }
}

/** Everything the upgrade screen needs for one piece of equipment. */
export function describeEquipmentUpgrade(
  type: EquipmentType,
  level: number,
  coins: number
): EquipmentUpgradeInfo {
  const definition = getEquipmentDefinition(type);
  const current = clampEquipmentLevel(type, level);
  const isMaxLevel = current >= definition.maxLevel;
  const currentEffect = getEquipmentEffect(type, current);
  const nextConfig = isMaxLevel ? null : getEquipmentLevelConfig(type, current + 1);
  const cost = nextConfig?.upgradeCost ?? null;
  return {
    type,
    name: definition.name,
    description: definition.description,
    level: current,
    maxLevel: definition.maxLevel,
    isMaxLevel,
    currentEffect,
    nextEffect: nextConfig?.effectValue ?? null,
    currentEffectText: describeEffect(type, currentEffect),
    nextEffectText: nextConfig ? describeEffect(type, nextConfig.effectValue) : null,
    cost,
    canAfford: cost !== null && coins >= cost
  };
}

/** Sell-price multiplier granted by the bait at this level (1.00 -> 1.25). */
export function getSellMultiplier(baitLevel: number): number {
  return getEquipmentEffect("bait", baitLevel);
}

/**
 * Coins for selling one fish: sellPrice x bait multiplier x (perfect ? 1.5 : 1), rounded
 * to a whole number (halves round up).
 */
export function calculateSalePrice(fish: FishDefinition, baitLevel: number, perfect = false): number {
  const raw =
    fish.sellPrice * getSellMultiplier(baitLevel) * (perfect ? GAME_CONFIG.perfectSellMultiplier : 1);
  // Strip floating-point noise (e.g. 16.499999999999996) before rounding.
  return Math.round(Math.round(raw * 1e6) / 1e6);
}
