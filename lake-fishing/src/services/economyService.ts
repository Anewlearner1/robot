import {
  clampEquipmentLevel,
  getEquipmentDefinition,
  getEquipmentEffect,
  getEquipmentLevelConfig
} from "../data/equipment";
import { GAME_CONFIG } from "../data/gameConfig";
import type { EquipmentType, FishDefinition, GameSave } from "../types/game";
import { getFishingIntervalSeconds } from "./fishingService";

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
  /** Raw effect values: rod = interval multiplier, line = rarity shift, bait = target-fish pick-weight multiplier. */
  currentEffect: number;
  nextEffect: number | null;
  /** Ready-to-display Traditional Chinese text, e.g. "間隔 ×0.92（83 秒）". */
  currentEffectText: string;
  nextEffectText: string | null;
  /** Coins needed for the next level; null at max level. */
  cost: number | null;
  canAfford: boolean;
  /** Coins still missing for the next level; 0 when affordable or at max level. */
  shortfall: number;
}

function describeEffect(type: EquipmentType, effect: number, level: number): string {
  switch (type) {
    case "rod":
      return `間隔 ×${effect.toFixed(2)}（${getFishingIntervalSeconds(level)} 秒）`;
    case "line":
      return effect === 0 ? "無加成" : `${Math.round(effect * 100)}% 機會改釣更稀有的魚`;
    case "bait":
      return effect === 1
        ? `${GAME_CONFIG.bait.groupName}同稀有度內權重 ×1.00（無加成）`
        : `${GAME_CONFIG.bait.groupName}在同稀有度內被釣到的權重 ×${effect.toFixed(2)}（不影響稀有度與賣價）`;
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
    currentEffectText: describeEffect(type, currentEffect, current),
    nextEffectText: nextConfig ? describeEffect(type, nextConfig.effectValue, current + 1) : null,
    cost,
    canAfford: cost !== null && coins >= cost,
    shortfall: cost === null ? 0 : Math.max(0, cost - coins)
  };
}

/**
 * Coins for selling `quantity` (default 1) of a fish: always `fish.sellPrice` each. There is no
 * multiplier of any kind (no bait, no perfect bonus).
 */
export function getSalePrice(fish: Pick<FishDefinition, "sellPrice">, quantity = 1): number {
  return fish.sellPrice * quantity;
}
