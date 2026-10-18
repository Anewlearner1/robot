import { describe, expect, it } from "vitest";
import { EQUIPMENT } from "../data/equipment";
import { FISH } from "../data/fish";
import { calculateSalePrice, describeEquipmentUpgrade, getSellMultiplier, tryUpgradeEquipment, upgradeEquipment } from "./economyService";
import { createNewSave } from "./saveService";

describe("equipment upgrade", () => {
  it("rejects an upgrade when coins are insufficient without charging the player", () => {
    expect(tryUpgradeEquipment("rod", 1, 99)).toEqual({
      success: false,
      reason: "INSUFFICIENT_COINS",
      coins: 99,
      level: 1
    });
  });

  it("charges the correct cost and advances one level", () => {
    expect(tryUpgradeEquipment("rod", 1, 100)).toEqual({
      success: true,
      coins: 0,
      level: 2
    });
  });

  it("rejects an upgrade at maximum level", () => {
    expect(tryUpgradeEquipment("rod", 6, 10000).reason).toBe("MAX_LEVEL");
  });

  it("rejects invalid levels", () => {
    expect(tryUpgradeEquipment("rod", 0, 10000).reason).toBe("INVALID_LEVEL");
    expect(tryUpgradeEquipment("rod", 1.5, 10000).reason).toBe("INVALID_LEVEL");
    expect(tryUpgradeEquipment("rod", 7, 10000).reason).toBe("INVALID_LEVEL");
  });

  it("walks every equipment through all levels at its listed costs", () => {
    for (const equipment of EQUIPMENT) {
      let coins = 100_000;
      let level = 1;
      while (level < equipment.maxLevel) {
        const cost = equipment.levels[level].upgradeCost!;
        const result = tryUpgradeEquipment(equipment.id, level, coins);
        expect(result).toEqual({ success: true, coins: coins - cost, level: level + 1 });
        coins = result.coins;
        level = result.level;
      }
    }
  });

  it("upgradeEquipment applies to the save immutably and leaves it untouched on failure", () => {
    const poor = createNewSave(1);
    const failed = upgradeEquipment(poor, "line");
    expect(failed.result.success).toBe(false);
    expect(failed.save).toBe(poor);

    const rich = { ...poor, coins: 500 };
    const ok = upgradeEquipment(rich, "line");
    expect(ok.save.coins).toBe(350);
    expect(ok.save.equipmentLevels).toEqual({ rod: 1, line: 2, bait: 1 });
    expect(rich.equipmentLevels.line).toBe(1);
  });
});

describe("describeEquipmentUpgrade", () => {
  it("describes the next level of the rod", () => {
    const info = describeEquipmentUpgrade("rod", 1, 100);
    expect(info).toMatchObject({
      level: 1,
      maxLevel: 6,
      isMaxLevel: false,
      currentEffect: 1,
      nextEffect: 0.92,
      cost: 100,
      canAfford: true,
      currentEffectText: "間隔 ×1.00（90 秒）",
      nextEffectText: "間隔 ×0.92（83 秒）"
    });
  });

  it("reports affordability", () => {
    expect(describeEquipmentUpgrade("bait", 1, 199).canAfford).toBe(false);
    expect(describeEquipmentUpgrade("bait", 1, 200).canAfford).toBe(true);
  });

  it("has no next level at max", () => {
    const info = describeEquipmentUpgrade("bait", 6, 99999);
    expect(info).toMatchObject({ isMaxLevel: true, nextEffect: null, nextEffectText: null, cost: null, canAfford: false });
    expect(info.currentEffectText).toBe("賣價 ×1.25");
  });

  it("describes line effects and clamps bad levels", () => {
    expect(describeEquipmentUpgrade("line", 1, 0).currentEffectText).toBe("無加成");
    expect(describeEquipmentUpgrade("line", 6, 0).currentEffectText).toContain("10%");
    expect(describeEquipmentUpgrade("line", 99, 0).level).toBe(6);
    expect(describeEquipmentUpgrade("line", -3, 0).level).toBe(1);
  });
});

describe("sale price", () => {
  const koi = FISH.find((f) => f.id === "fish_koi")!;
  it("scales with the bait level", () => {
    expect(getSellMultiplier(1)).toBe(1);
    expect(getSellMultiplier(6)).toBe(1.25);
    expect(calculateSalePrice(koi, 1)).toBe(50);
    expect(calculateSalePrice(koi, 4)).toBe(58); // 57.5 rounds up
    expect(calculateSalePrice(koi, 6)).toBe(63); // 62.5 rounds up
  });

  it("applies the perfect x1.5 bonus", () => {
    expect(calculateSalePrice(koi, 1, true)).toBe(75);
    expect(calculateSalePrice(koi, 6, true)).toBe(94);
  });

  it("always returns an integer for every fish, bait level and perfect flag", () => {
    for (const fish of FISH) {
      for (let bait = 1; bait <= 6; bait++) {
        for (const perfect of [false, true]) {
          expect(Number.isInteger(calculateSalePrice(fish, bait, perfect))).toBe(true);
        }
      }
    }
  });
});
