import { describe, expect, it } from "vitest";
import { EQUIPMENT } from "../data/equipment";
import { GAME_CONFIG } from "../data/gameConfig";
import { FISH } from "../data/fish";
import { describeEquipmentUpgrade, getSalePrice, tryUpgradeEquipment, upgradeEquipment } from "./economyService";
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
      shortfall: 0,
      currentEffectText: "間隔 ×1.00（90 秒）",
      nextEffectText: "間隔 ×0.92（83 秒）"
    });
  });

  it("rod texts show the PRD interval at every level", () => {
    const seconds = [90, 83, 76, 68, 61, 54];
    seconds.forEach((value, index) => {
      expect(describeEquipmentUpgrade("rod", index + 1, 0).currentEffectText).toContain(`（${value} 秒）`);
    });
  });

  it("reports affordability and the exact shortfall", () => {
    expect(describeEquipmentUpgrade("bait", 1, 199)).toMatchObject({ canAfford: false, shortfall: 1 });
    expect(describeEquipmentUpgrade("bait", 1, 200)).toMatchObject({ canAfford: true, shortfall: 0 });
    expect(describeEquipmentUpgrade("bait", 1, 0).shortfall).toBe(200);
    expect(describeEquipmentUpgrade("rod", 1, 40).shortfall).toBe(60);
    expect(describeEquipmentUpgrade("line", 2, 100).shortfall).toBe(140);
    expect(describeEquipmentUpgrade("rod", 5, 10_000).shortfall).toBe(0);
  });

  it("has no next level and no shortfall at max", () => {
    const info = describeEquipmentUpgrade("bait", 6, 0);
    expect(info).toMatchObject({ isMaxLevel: true, nextEffect: null, nextEffectText: null, cost: null, canAfford: false, shortfall: 0 });
  });

  it("describes what the bait does: target-group weight within a rarity, no price or rarity change", () => {
    const base = describeEquipmentUpgrade("bait", 1, 0);
    expect(base.currentEffectText).toContain("無加成");
    expect(base.currentEffectText).toContain(GAME_CONFIG.bait.groupName);
    const info = describeEquipmentUpgrade("bait", 5, 0);
    expect(info.currentEffect).toBe(1.8);
    expect(info.nextEffect).toBe(2);
    expect(info.nextEffectText).toContain("×2.00");
    expect(info.nextEffectText).toContain(GAME_CONFIG.bait.groupName);
    expect(info.nextEffectText).toContain("同稀有度");
    expect(info.nextEffectText).toContain("不影響稀有度與賣價");
    expect(info.nextEffectText).not.toContain("賣價 ×");
    expect(info.description).toContain("同一稀有度");
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

  it("is always the fish's sellPrice, times the quantity", () => {
    expect(getSalePrice(koi)).toBe(50);
    expect(getSalePrice(koi, 3)).toBe(150);
    for (const fish of FISH) expect(getSalePrice(fish)).toBe(fish.sellPrice);
  });

  it("has no perfect multiplier left anywhere in the config", () => {
    expect("perfectSellMultiplier" in GAME_CONFIG).toBe(false);
  });
});
