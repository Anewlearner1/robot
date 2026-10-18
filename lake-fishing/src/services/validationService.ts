import { FISH, LEGACY_FISH_ID_MAP } from "../data/fish";
import { EQUIPMENT } from "../data/equipment";
import { GAME_CONFIG } from "../data/gameConfig";
import type { FishRarity } from "../types/game";

export interface ValidationIssue {
  code: string;
  message: string;
}

export function validateStaticGameData(): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const ids = FISH.map((fish) => fish.id);

  if (FISH.length !== 25) {
    issues.push({ code: "FISH_COUNT", message: `Expected 25 fish, got ${FISH.length}.` });
  }

  if (new Set(ids).size !== ids.length) {
    issues.push({ code: "DUPLICATE_FISH_ID", message: "Fish IDs must be unique." });
  }

  const imageKeys = FISH.map((fish) => fish.imageKey);
  if (new Set(imageKeys).size !== imageKeys.length) {
    issues.push({ code: "DUPLICATE_IMAGE_KEY", message: "Fish imageKeys must be unique." });
  }

  for (const [oldId, newId] of Object.entries(LEGACY_FISH_ID_MAP)) {
    if (ids.includes(oldId)) {
      issues.push({ code: "LEGACY_ID_STILL_PRESENT", message: `Legacy fish id ${oldId} must not exist in FISH.` });
    }
    if (!ids.includes(newId)) {
      issues.push({ code: "LEGACY_ID_TARGET_MISSING", message: `Legacy fish id ${oldId} maps to unknown ${newId}.` });
    }
  }

  for (const fish of FISH) {
    if (fish.imageKey !== fish.id.replace(/^fish_/, "fish-").replace(/_/g, "-")) {
      issues.push({ code: "IMAGE_KEY_MISMATCH", message: `Fish ${fish.id} imageKey should be ${fish.id.replace(/^fish_/, "fish-").replace(/_/g, "-")}.` });
    }
    if (!fish.id || !fish.name || !fish.imageKey) {
      issues.push({ code: "MISSING_FISH_FIELD", message: `Fish ${fish.id || "(unknown)"} has a missing required field.` });
    }
    if (!Number.isFinite(fish.sellPrice) || fish.sellPrice < 0) {
      issues.push({ code: "INVALID_FISH_PRICE", message: `Fish ${fish.id} has an invalid sell price.` });
    }
    if (fish.autoSell !== (fish.rarity === "common" || fish.rarity === "uncommon")) {
      issues.push({ code: "AUTO_SELL_MISMATCH", message: `Fish ${fish.id} has an inconsistent autoSell setting.` });
    }
  }

  const totalWeight = Object.values(GAME_CONFIG.rarityWeights).reduce((sum, weight) => sum + weight, 0);
  if (Math.abs(totalWeight - 100) > 0.000001) {
    issues.push({ code: "RARITY_WEIGHT_TOTAL", message: `Rarity weights must total 100; got ${totalWeight}.` });
  }

  const rarityOrder: FishRarity[] = ["common", "uncommon", "rare", "epic", "legendary"];
  for (const rarity of rarityOrder) {
    const expectedUnlock = GAME_CONFIG.collectionUnlocks[rarity];
    const fishWithRarity = FISH.filter((fish) => fish.rarity === rarity);
    if (fishWithRarity.length === 0) {
      issues.push({ code: "EMPTY_RARITY", message: `No fish configured for rarity ${rarity}.` });
    }
    if (fishWithRarity.some((fish) => fish.unlockCollectionCount !== expectedUnlock)) {
      issues.push({ code: "UNLOCK_MISMATCH", message: `Fish unlock threshold mismatch for rarity ${rarity}.` });
    }
  }

  for (const equipment of EQUIPMENT) {
    if (equipment.levels.length !== equipment.maxLevel) {
      issues.push({ code: "EQUIPMENT_LEVEL_COUNT", message: `${equipment.id} levels do not match maxLevel.` });
    }
    for (let i = 0; i < equipment.levels.length; i++) {
      const level = equipment.levels[i];
      if (level.level !== i + 1) {
        issues.push({ code: "EQUIPMENT_LEVEL_SEQUENCE", message: `${equipment.id} levels must be sequential.` });
      }
      if (i === 0 && level.upgradeCost !== null) {
        issues.push({ code: "STARTING_LEVEL_COST", message: `${equipment.id} level 1 must not have an upgrade cost.` });
      }
      if (i > 0 && (level.upgradeCost === null || level.upgradeCost < 0)) {
        issues.push({ code: "INVALID_UPGRADE_COST", message: `${equipment.id} level ${level.level} has invalid upgrade cost.` });
      }
    }
  }

  // Legendary pity bands must start at 0, be contiguous and increasing.
  const bands = GAME_CONFIG.legendaryPity;
  let expectedMin = 0;
  bands.forEach((band, index) => {
    const isLast = index === bands.length - 1;
    if (band.min !== expectedMin || (isLast ? band.max !== null : band.max === null || band.max < band.min)) {
      issues.push({ code: "PITY_BANDS", message: `Legendary pity band ${index} is not contiguous.` });
    }
    if (band.chance < GAME_CONFIG.rarityWeights.legendary / 100 || band.chance >= 1) {
      issues.push({ code: "PITY_CHANCE", message: `Legendary pity band ${index} has an invalid chance.` });
    }
    expectedMin = band.max === null ? band.min : band.max + 1;
  });

  const mg = GAME_CONFIG.minigame;
  const minigameOk =
    mg.timeLimitMs >= 8000 && mg.timeLimitMs <= 12_000 &&
    mg.zoneHalfWidth > 0 && mg.zoneHalfWidth < 0.5 &&
    mg.zoneAmplitude + mg.zoneHalfWidth <= 0.5 &&
    mg.startProgress >= 0 && mg.startProgress < 1 &&
    mg.fillPerSecond > mg.drainPerSecond && mg.drainPerSecond >= 0 &&
    mg.zonePeriodMs.min > 0 && mg.zonePeriodMs.max >= mg.zonePeriodMs.min &&
    mg.promptTimeoutMs === 15_000;
  if (!minigameOk) {
    issues.push({ code: "MINIGAME_CONFIG", message: "gameConfig.minigame has values outside the intended ranges." });
  }

  return issues;
}
