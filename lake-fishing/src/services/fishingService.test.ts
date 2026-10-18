import { describe, expect, it } from "vitest";
import { getEquipmentEffect } from "../data/equipment";
import { FISH } from "../data/fish";
import { GAME_CONFIG } from "../data/gameConfig";
import type { FishRarity } from "../types/game";
import {
  applyLegendaryPity,
  applyLineEffect,
  chooseRarity,
  getBaseRarityWeights,
  getFishingIntervalSeconds,
  getLegendaryChance,
  getRarityWeights,
  getSaveRarityWeights,
  getUnlockedRarities,
  isMinigameEligible,
  pickRarity,
  RARITY_ORDER,
  rollCatch
} from "./fishingService";
import { FISH_IDS, saveWithDiscovered, seededRng, sequenceRng } from "./testUtils";

const total = (weights: Record<FishRarity, number>) => RARITY_ORDER.reduce((sum, r) => sum + weights[r], 0);
const discovered = (n: number) => FISH_IDS.slice(0, n);

describe("unlock gating", () => {
  it.each([
    [0, ["common"]],
    [4, ["common"]],
    [5, ["common", "uncommon"]],
    [10, ["common", "uncommon", "rare"]],
    [15, ["common", "uncommon", "rare", "epic"]],
    [20, ["common", "uncommon", "rare", "epic", "legendary"]]
  ])("with %i discovered fish unlocks %j", (count, expected) => {
    expect(getUnlockedRarities(discovered(count))).toEqual(expected);
  });

  it("ignores unknown and duplicate ids when counting", () => {
    const ids = [...discovered(4), FISH_IDS[0], "fish_cultrure", "nope", "__proto__"];
    expect(getUnlockedRarities(ids)).toEqual(["common"]);
  });

  it("never rolls a locked rarity", () => {
    const rng = seededRng(1);
    for (let i = 0; i < 2000; i++) {
      expect(chooseRarity(discovered(4), 0, rng, 0.1)).toBe("common");
    }
    const weights = getRarityWeights(discovered(12), 300, 0.1);
    expect(weights.epic).toBe(0);
    expect(weights.legendary).toBe(0);
  });
});

describe("rarity weights", () => {
  it("matches the spec weights when everything is unlocked", () => {
    const w = getRarityWeights(discovered(20));
    expect(w.common).toBeCloseTo(60);
    expect(w.uncommon).toBeCloseTo(25);
    expect(w.rare).toBeCloseTo(11);
    expect(w.epic).toBeCloseTo(3.5);
    expect(w.legendary).toBeCloseTo(0.5);
  });

  it.each([0, 5, 10, 15, 20])("sums to 100 with %i fish discovered, any pity, any line", (count) => {
    for (const pity of [0, 49, 50, 100, 150, 199, 200, 5000]) {
      for (const line of [0, 0.02, 0.06, 0.1]) {
        const w = getRarityWeights(discovered(count), pity, line);
        expect(total(w)).toBeCloseTo(100, 9);
        for (const rarity of RARITY_ORDER) expect(w[rarity]).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("renormalises over unlocked rarities", () => {
    const w = getBaseRarityWeights(["common", "uncommon"]);
    expect(w.common).toBeCloseTo((60 / 85) * 100);
    expect(w.uncommon).toBeCloseTo((25 / 85) * 100);
    expect(w.rare + w.epic + w.legendary).toBe(0);
  });

  it("returns all zero when nothing is unlocked", () => {
    expect(total(getBaseRarityWeights([]))).toBe(0);
  });
});

describe("legendary pity", () => {
  it.each([
    [0, 0.005],
    [49, 0.005],
    [50, 0.0075],
    [99, 0.0075],
    [100, 0.01],
    [150, 0.015],
    [199, 0.015],
    [200, 0.02],
    [9999, 0.02]
  ])("pity %i -> chance %f", (count, chance) => {
    expect(getLegendaryChance(count)).toBe(chance);
  });

  it("raises legendary to the band chance and keeps the total at 100", () => {
    const w = getRarityWeights(discovered(20), 200);
    expect(w.legendary).toBeCloseTo(2);
    expect(total(w)).toBeCloseTo(100, 9);
  });

  it("takes the increase proportionally from every other unlocked tier", () => {
    const base = getRarityWeights(discovered(20), 0);
    const w = getRarityWeights(discovered(20), 200);
    const factor = (100 - 2) / (100 - 0.5);
    for (const rarity of ["common", "uncommon", "rare", "epic"] as FishRarity[]) {
      expect(w[rarity]).toBeCloseTo(base[rarity] * factor, 9);
    }
  });

  it("does nothing while legendary is locked", () => {
    const unlocked = getUnlockedRarities(discovered(19));
    const base = getBaseRarityWeights(unlocked);
    expect(applyLegendaryPity(base, unlocked, 500)).toEqual(base);
    expect(getRarityWeights(discovered(19), 500).legendary).toBe(0);
  });

  it("is monotonic in the pity counter", () => {
    let previous = 0;
    for (const pity of [0, 50, 100, 150, 200]) {
      const legendary = getRarityWeights(discovered(20), pity).legendary;
      expect(legendary).toBeGreaterThanOrEqual(previous);
      previous = legendary;
    }
  });

  it("treats junk counters as 0", () => {
    expect(getLegendaryChance(-5)).toBe(0.005);
    expect(getLegendaryChance(Number.NaN)).toBe(0.005);
  });
});

describe("line effect", () => {
  const all = [...RARITY_ORDER];

  it("moves effect x total from common to the rarer tiers in proportion to their weights", () => {
    const base = getBaseRarityWeights(all);
    const w = applyLineEffect(base, all, 0.1);
    expect(w.common).toBeCloseTo(50, 9);
    expect(w.uncommon).toBeCloseTo(25 + 6.25, 9);
    expect(w.rare).toBeCloseTo(11 + 2.75, 9);
    expect(w.epic).toBeCloseTo(3.5 + 0.875, 9);
    expect(w.legendary).toBeCloseTo(0.5 + 0.125, 9);
    expect(total(w)).toBeCloseTo(100, 9);
  });

  it("splits only among unlocked tiers, proportionally", () => {
    const unlocked = getUnlockedRarities(discovered(10));
    const base = getBaseRarityWeights(unlocked);
    const w = applyLineEffect(base, unlocked, 0.1);
    expect(total(w)).toBeCloseTo(100, 9);
    expect(w.epic).toBe(0);
    expect(w.legendary).toBe(0);
    const above = base.uncommon + base.rare;
    expect(w.uncommon - base.uncommon).toBeCloseTo(10 * (base.uncommon / above), 9);
    expect(w.rare - base.rare).toBeCloseTo(10 * (base.rare / above), 9);
  });

  it("sums to 100 for every number of unlocked tiers", () => {
    for (const count of [0, 5, 10, 15, 20]) {
      const unlocked = getUnlockedRarities(discovered(count));
      const w = applyLineEffect(getBaseRarityWeights(unlocked), unlocked, 0.1);
      expect(total(w)).toBeCloseTo(100, 9);
    }
  });

  it("keeps each tier's share of the rarer fish unchanged", () => {
    const base = getBaseRarityWeights(all);
    const w = applyLineEffect(base, all, 0.1);
    expect(w.legendary / w.uncommon).toBeCloseTo(base.legendary / base.uncommon, 9);
  });

  it("does nothing when only common is unlocked or the effect is 0", () => {
    const only = getBaseRarityWeights(["common"]);
    expect(applyLineEffect(only, ["common"], 0.1)).toEqual(only);
    const base = getBaseRarityWeights(all);
    expect(applyLineEffect(base, all, 0)).toEqual(base);
  });

  it.each([1, 2, 3, 4, 5, 6])("line level %i sums to 100 and shifts the configured amount", (level) => {
    const effect = getEquipmentEffect("line", level);
    const w = getRarityWeights(discovered(20), 0, effect);
    expect(total(w)).toBeCloseTo(100, 9);
    expect(w.common).toBeCloseTo(60 - effect * 100, 9);
  });

  it("is read from the save's line level", () => {
    const save = { ...saveWithDiscovered(20), equipmentLevels: { rod: 1, line: 6, bait: 1 } };
    expect(getSaveRarityWeights(save).common).toBeCloseTo(50);
  });

  it("raises the rarer-fish rate in simulation", () => {
    const count = (line: number) => {
      const rng = seededRng(99);
      let rarer = 0;
      for (let i = 0; i < 20000; i++) if (chooseRarity(discovered(20), 0, rng, line) !== "common") rarer++;
      return rarer / 20000;
    };
    expect(count(0.1)).toBeGreaterThan(count(0) + 0.07);
  });

  it("works together with pity", () => {
    const w = getRarityWeights(discovered(20), 200, 0.1);
    expect(total(w)).toBeCloseTo(100, 9);
    expect(w.legendary).toBeCloseTo(0.625 + 1.5, 9 - 1);
  });
});

describe("fishing interval", () => {
  it("reads the rod multiplier from equipment data", () => {
    expect(getFishingIntervalSeconds(1)).toBe(90);
    expect(getFishingIntervalSeconds(2)).toBe(Math.round(90 * getEquipmentEffect("rod", 2)));
    expect(getFishingIntervalSeconds(6)).toBe(54);
  });

  it("clamps out-of-range levels", () => {
    expect(getFishingIntervalSeconds(0)).toBe(90);
    expect(getFishingIntervalSeconds(99)).toBe(54);
    expect(getFishingIntervalSeconds(Number.NaN)).toBe(90);
  });

  it("never goes below the configured minimum", () => {
    for (let level = 1; level <= 6; level++) {
      expect(getFishingIntervalSeconds(level)).toBeGreaterThanOrEqual(GAME_CONFIG.minimumFishingIntervalSeconds);
    }
  });
});

describe("rolling", () => {
  it("pickRarity walks the cumulative weights", () => {
    const w = getRarityWeights(discovered(20));
    expect(pickRarity(w, () => 0)).toBe("common");
    expect(pickRarity(w, () => 0.5999)).toBe("common");
    expect(pickRarity(w, () => 0.61)).toBe("uncommon");
    expect(pickRarity(w, () => 0.9999)).toBe("legendary");
  });

  it("rollCatch uses two draws: rarity, then a uniform fish", () => {
    const save = saveWithDiscovered(20);
    expect(rollCatch(save, sequenceRng([0, 0])).id).toBe(FISH_IDS[0]);
    const legendary = rollCatch(save, sequenceRng([0.9999, 0.99]));
    expect(legendary.rarity).toBe("legendary");
    expect(legendary.id).toBe(FISH_IDS[24]);
  });

  it("is deterministic for a seed and only returns unlocked rarities", () => {
    const save = saveWithDiscovered(5);
    const a = Array.from({ length: 50 }, ((rng) => () => rollCatch(save, rng).id)(seededRng(7)));
    const b = Array.from({ length: 50 }, ((rng) => () => rollCatch(save, rng).id)(seededRng(7)));
    expect(a).toEqual(b);
    for (const id of a) {
      const fish = FISH.find((f) => f.id === id)!;
      expect(["common", "uncommon"]).toContain(fish.rarity);
    }
  });

  it("approximates the spec distribution", () => {
    const save = saveWithDiscovered(20);
    const rng = seededRng(2024);
    const counts: Record<string, number> = {};
    const n = 40000;
    for (let i = 0; i < n; i++) {
      const rarity = rollCatch(save, rng).rarity;
      counts[rarity] = (counts[rarity] ?? 0) + 1;
    }
    expect(counts.common / n).toBeGreaterThan(0.58);
    expect(counts.common / n).toBeLessThan(0.62);
    expect(counts.rare / n).toBeGreaterThan(0.095);
    expect(counts.rare / n).toBeLessThan(0.125);
  });

  it("flags rare and above as minigame-eligible", () => {
    const eligible = FISH.filter(isMinigameEligible).map((f) => f.rarity);
    expect(new Set(eligible)).toEqual(new Set(["rare", "epic", "legendary"]));
  });
});
