import type { EquipmentDefinition, EquipmentLevelConfig, EquipmentType } from "../types/game";

export const EQUIPMENT: EquipmentDefinition[] = [
  {
    id: "rod",
    name: "魚竿",
    description: "縮短釣魚間隔。",
    maxLevel: 6,
    levels: [
      { level: 1, upgradeCost: null, effectValue: 1.00 },
      { level: 2, upgradeCost: 100, effectValue: 0.92 },
      { level: 3, upgradeCost: 160, effectValue: 0.84 },
      { level: 4, upgradeCost: 260, effectValue: 0.76 },
      { level: 5, upgradeCost: 410, effectValue: 0.68 },
      { level: 6, upgradeCost: 660, effectValue: 0.60 }
    ]
  },
  {
    id: "line",
    name: "釣線",
    description: "提高少見以上魚種的出現機率。",
    maxLevel: 6,
    levels: [
      { level: 1, upgradeCost: null, effectValue: 0 },
      { level: 2, upgradeCost: 150, effectValue: 0.02 },
      { level: 3, upgradeCost: 240, effectValue: 0.04 },
      { level: 4, upgradeCost: 380, effectValue: 0.06 },
      { level: 5, upgradeCost: 610, effectValue: 0.08 },
      { level: 6, upgradeCost: 980, effectValue: 0.10 }
    ]
  },
  {
    id: "bait",
    name: "魚餌",
    description: "提高鯉科魚群在同一稀有度內被釣到的機率；不改變稀有度機率與賣價。",
    maxLevel: 6,
    levels: [
      { level: 1, upgradeCost: null, effectValue: 1.0 },
      { level: 2, upgradeCost: 200, effectValue: 1.2 },
      { level: 3, upgradeCost: 320, effectValue: 1.4 },
      { level: 4, upgradeCost: 510, effectValue: 1.6 },
      { level: 5, upgradeCost: 820, effectValue: 1.8 },
      { level: 6, upgradeCost: 1310, effectValue: 2.0 }
    ]
  }
];

export function getEquipmentDefinition(type: EquipmentType): EquipmentDefinition {
  const definition = EQUIPMENT.find((item) => item.id === type);
  if (!definition) throw new Error(`Unknown equipment: ${type}`);
  return definition;
}

/** Clamp any number to a valid level (1..maxLevel) for this equipment. */
export function clampEquipmentLevel(type: EquipmentType, level: number): number {
  const { maxLevel } = getEquipmentDefinition(type);
  if (!Number.isFinite(level)) return 1;
  return Math.min(maxLevel, Math.max(1, Math.floor(level)));
}

/** The level row (effect, cost) for a level; the level is clamped into range. */
export function getEquipmentLevelConfig(type: EquipmentType, level: number): EquipmentLevelConfig {
  return getEquipmentDefinition(type).levels[clampEquipmentLevel(type, level) - 1];
}

/**
 * The raw effect value at a level.
 * rod: interval multiplier (display only; the interval itself comes from GAME_CONFIG.rod);
 * line: share of weight moved to rarer fish; bait: pick-weight multiplier of the target group.
 */
export function getEquipmentEffect(type: EquipmentType, level: number): number {
  return getEquipmentLevelConfig(type, level).effectValue;
}
