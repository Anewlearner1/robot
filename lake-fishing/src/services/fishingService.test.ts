import { describe, expect, it } from "vitest";
import { getEquipmentEffect } from "../data/equipment";
import { FISH } from "../data/fish";
import { GAME_CONFIG } from "../data/gameConfig";
import type { FishRarity } from "../types/game";
import {
  applyLegendaryPity,
  applyLineEffect,
  applyStreakBonus,
  chooseFishForRarity,
  chooseRarity,
  getBaitMultiplier,
  getBaitTargetFish,
  getBaseRarityWeights,
  getFishingIntervalSeconds,
  getFishPickChances,
  getLegendaryChance,
  getRarityWeights,
  getSaveRarityWeights,
  getUnlockedRarities,
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
    [149, 0.01],
    [150, 0.015],
    [199, 0.015],
    [200, 0.02],
    [9999, 0.02]
  ])("pity %i -> chance %f", (count, chance) => {
    expect(getLegendaryChance(count)).toBe(chance);
  });

  it.each([
    [49, 50, 0.5, 0.75],
    [99, 100, 0.75, 1],
    [149, 150, 1, 1.5],
    [199, 200, 1.5, 2]
  ])("the PRD boundary %i / %i moves legendary from %f%% to %f%% in the final weights", (low, high, lowPct, highPct) => {
    expect(getRarityWeights(discovered(20), low).legendary).toBeCloseTo(lowPct, 9);
    expect(getRarityWeights(discovered(20), high).legendary).toBeCloseTo(highPct, 9);
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

describe("fishing interval (PRD §7 rod formula)", () => {
  // Independent expectations: PRD §7 formula evaluated by hand for levels 1-6.
  it.each([
    [1, 90],
    [2, 83],
    [3, 76],
    [4, 68],
    [5, 61],
    [6, 54]
  ])("rod level %i -> %i seconds", (level, seconds) => {
    expect(getFishingIntervalSeconds(level)).toBe(seconds);
    // The literal PRD expression, constants and all.
    expect(getFishingIntervalSeconds(level)).toBe(Math.max(30, Math.round(90 * (1 - 0.08 * (level - 1)))));
  });

  it("takes its constants from the config", () => {
    expect(GAME_CONFIG.rod).toEqual({ baseIntervalSeconds: 90, reductionPerLevel: 0.08, minimumIntervalSeconds: 30 });
    expect(getFishingIntervalSeconds(3, { baseIntervalSeconds: 100, reductionPerLevel: 0.1, minimumIntervalSeconds: 30 })).toBe(80);
  });

  it("clamps to the 30 s floor when the slope is steep enough to go below it", () => {
    const steep = { baseIntervalSeconds: 90, reductionPerLevel: 0.2, minimumIntervalSeconds: 30 };
    // level 6 would be round(90 * (1 - 0.2 * 5)) = 0 without the floor
    expect(getFishingIntervalSeconds(6, steep)).toBe(30);
    expect(getFishingIntervalSeconds(5, steep)).toBe(30); // 90 * 0.2 = 18 -> floor
    expect(getFishingIntervalSeconds(3, steep)).toBe(54); // 90 * 0.6, above the floor: untouched
    expect(getFishingIntervalSeconds(1, steep)).toBe(90);
  });

  it("clamps to the floor when the base interval is low", () => {
    const low = { baseIntervalSeconds: 40, reductionPerLevel: 0.08, minimumIntervalSeconds: 30 };
    expect(getFishingIntervalSeconds(1, low)).toBe(40);
    expect(getFishingIntervalSeconds(4, low)).toBe(30); // 40 * 0.76 = 30.4 -> 30 (equal to floor)
    expect(getFishingIntervalSeconds(6, low)).toBe(30); // 40 * 0.6 = 24 -> floor
    for (let level = 1; level <= 6; level++) expect(getFishingIntervalSeconds(level, low)).toBeGreaterThanOrEqual(30);
  });

  it("clamps out-of-range levels", () => {
    expect(getFishingIntervalSeconds(0)).toBe(90);
    expect(getFishingIntervalSeconds(99)).toBe(54);
    expect(getFishingIntervalSeconds(Number.NaN)).toBe(90);
  });

  it("never goes below the configured minimum", () => {
    for (let level = 1; level <= 6; level++) {
      expect(getFishingIntervalSeconds(level)).toBeGreaterThanOrEqual(GAME_CONFIG.rod.minimumIntervalSeconds);
    }
  });
});

describe("bait: within-rarity pick weight for the target group", () => {
  const targets = new Set<string>(GAME_CONFIG.bait.targetFishIds);
  const share = (rarity: FishRarity, bait: number) =>
    getFishPickChances(rarity, bait)
      .filter((entry) => targets.has(entry.fish.id))
      .reduce((sum, entry) => sum + entry.chance, 0);

  it("multiplies Lv1..Lv6 from x1.0 to x2.0, configured in data", () => {
    expect([1, 2, 3, 4, 5, 6].map(getBaitMultiplier)).toEqual([1, 1.2, 1.4, 1.6, 1.8, 2]);
    expect(getEquipmentEffect("bait", 6)).toBe(2);
  });

  it("targets the carp family listed in the design doc", () => {
    expect(getBaitTargetFish().map((fish) => fish.name)).toEqual([
      "小鯽魚", "鯉魚", "鯽魚", "彩鯽", "銀鯽", "金色鯉魚", "錦鯉", "月光鯉"
    ]);
  });

  it("never changes the rarity weights, for any bait level, pity, line or streak", () => {
    // getRarityWeights does not even take a bait argument; check a save's weights across levels.
    const save = saveWithDiscovered(20);
    const reference = getSaveRarityWeights(save);
    for (let bait = 1; bait <= 6; bait++) {
      expect(getSaveRarityWeights({ ...save, equipmentLevels: { ...save.equipmentLevels, bait } })).toEqual(reference);
    }
    const loaded = { ...save, pity: { consecutiveNonLegendary: 120 }, minigame: { perfectStreak: 4 }, equipmentLevels: { rod: 3, line: 4, bait: 1 } };
    const loadedReference = getSaveRarityWeights(loaded);
    for (let bait = 2; bait <= 6; bait++) {
      expect(getSaveRarityWeights({ ...loaded, equipmentLevels: { ...loaded.equipmentLevels, bait } })).toEqual(loadedReference);
    }
  });

  it("does not change the rarity of what is caught: same rarity sequence for every bait level", () => {
    const save = saveWithDiscovered(20);
    const rarities = (bait: number) => {
      const rng = seededRng(321);
      const withBait = { ...save, equipmentLevels: { ...save.equipmentLevels, bait } };
      return Array.from({ length: 500 }, () => {
        const fish = rollCatch(withBait, rng);
        return fish.rarity;
      });
    };
    // Each roll uses exactly 2 draws in the same order, so the rarity draws line up.
    expect(rarities(6)).toEqual(rarities(1));
  });

  it("leaves a rarity's own probabilities and its fish prices alone", () => {
    for (const rarity of RARITY_ORDER) {
      const sum = getFishPickChances(rarity, 6).reduce((total, entry) => total + entry.chance, 0);
      expect(sum).toBeCloseTo(1, 12);
    }
    expect(FISH.find((f) => f.id === "fish_koi")!.sellPrice).toBe(50);
  });

  it("raises the target group's share within a rarity as the level rises", () => {
    // common: 3 of 8 are targets -> 3/8 at x1.0, 6/11 at x2.0
    expect(share("common", 1)).toBeCloseTo(3 / 8, 12);
    expect(share("common", 6)).toBeCloseTo(6 / 11, 12);
    for (const rarity of ["common", "uncommon", "rare", "epic"] as FishRarity[]) {
      let previous = share(rarity, 1);
      for (let bait = 2; bait <= 6; bait++) {
        const next = share(rarity, bait);
        expect(next, `${rarity} bait ${bait}`).toBeGreaterThan(previous);
        previous = next;
      }
    }
    // uncommon: 2 of 7; rare: 2 of 5; epic: 1 of 3
    expect(share("uncommon", 6)).toBeCloseTo(4 / 9, 12);
    expect(share("rare", 6)).toBeCloseTo(4 / 7, 12);
    expect(share("epic", 6)).toBeCloseTo(2 / 4, 12);
  });

  it("is unaffected in a rarity without target fish (legendary)", () => {
    expect(getFishPickChances("legendary", 6).map((entry) => entry.chance)).toEqual([0.5, 0.5]);
  });

  it("raises the target fish's catch rate in simulation, rarity mix unchanged", () => {
    const count = (bait: number) => {
      const rng = seededRng(2468);
      const save = { ...saveWithDiscovered(20), equipmentLevels: { rod: 1, line: 1, bait } };
      let target = 0;
      let commons = 0;
      for (let i = 0; i < 30000; i++) {
        const fish = rollCatch(save, rng);
        if (fish.rarity === "common") {
          commons++;
          if (targets.has(fish.id)) target++;
        }
      }
      return { commons, targetShare: target / commons };
    };
    const lv1 = count(1);
    const lv6 = count(6);
    expect(lv1.commons).toBe(lv6.commons); // same rarity draws -> identical common count
    expect(lv1.targetShare).toBeGreaterThan(0.35);
    expect(lv1.targetShare).toBeLessThan(0.4);
    expect(lv6.targetShare).toBeGreaterThan(0.52);
    expect(lv6.targetShare).toBeLessThan(0.57);
  });

  it("non-target fish are still possible at the highest bait level", () => {
    for (const rarity of ["common", "uncommon", "rare", "epic"] as FishRarity[]) {
      const others = getFishPickChances(rarity, 6).filter((entry) => !targets.has(entry.fish.id));
      expect(others.length, rarity).toBeGreaterThan(0);
      for (const entry of others) expect(entry.chance).toBeGreaterThan(0);
    }
    // With an rng sweep across the common rarity every common fish shows up at bait 6.
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) seen.add(chooseFishForRarity("common", () => i / 1000, 6).id);
    expect(seen.size).toBe(8);
  });

  it("picks by cumulative weight with one draw", () => {
    // common fish in catalogue order: carp-family targets are #0 (crucian), #2 (carp), #4 (gibel)
    // bait 6: weights 2,1,2,1,2,1,1,1 = 11
    expect(chooseFishForRarity("common", () => 0, 6).id).toBe("fish_crucian_carp");
    expect(chooseFishForRarity("common", () => 1.9 / 11, 6).id).toBe("fish_crucian_carp");
    expect(chooseFishForRarity("common", () => 2.1 / 11, 6).id).toBe("fish_river_sprat");
    expect(chooseFishForRarity("common", () => 0.9999999, 6).id).toBe("fish_tank_goby");
    // bait 1 is a plain uniform pick: floor(0.5 * 8) = index 4 = fish_gibel
    expect(chooseFishForRarity("common", sequenceRng([0.5]), 1).id).toBe("fish_gibel");
  });
});

describe("perfect streak boost (rare+ only, after unlock, before pity)", () => {
  const streakConfig = { streakBonusPerPerfect: 0.1, streakBonusMax: 0.3 };
  const withStreak = (count: number, streak: number, pity = 0) =>
    getRarityWeights(discovered(count), pity, 0, streak, streakConfig);

  it("is off with the shipped config", () => {
    expect(GAME_CONFIG.minigame.streakBonusPerPerfect).toBe(0);
    expect(getRarityWeights(discovered(20), 0, 0, 10)).toEqual(getRarityWeights(discovered(20), 0, 0, 0));
  });

  it("raises unlocked rare+ weights relatively and keeps the total at 100", () => {
    const base = withStreak(20, 0);
    const boosted = withStreak(20, 2); // +20%
    expect(boosted.rare).toBeCloseTo(base.rare * 1.2 * (100 / (100 + 0.2 * (11 + 3.5 + 0.5))), 9);
    expect(boosted.epic / base.epic).toBeCloseTo(boosted.rare / base.rare, 9);
    expect(boosted.legendary / base.legendary).toBeCloseTo(boosted.rare / base.rare, 9);
    expect(boosted.common).toBeLessThan(base.common);
    expect(boosted.uncommon).toBeLessThan(base.uncommon);
    expect(total(boosted)).toBeCloseTo(100, 9);
  });

  it("is capped by streakBonusMax", () => {
    expect(withStreak(20, 3)).toEqual(withStreak(20, 99));
    expect(withStreak(20, 3).rare).toBeGreaterThan(withStreak(20, 2).rare);
  });

  it("cannot unlock a locked tier, whatever the streak", () => {
    for (const [count, locked] of [[0, ["uncommon", "rare", "epic", "legendary"]], [5, ["rare", "epic", "legendary"]], [10, ["epic", "legendary"]], [15, ["legendary"]]] as [number, FishRarity[]][]) {
      for (const streak of [0, 1, 5, 1000]) {
        const w = withStreak(count, streak, 500);
        for (const rarity of locked) expect(w[rarity], `${count} fish, streak ${streak}, ${rarity}`).toBe(0);
        expect(total(w)).toBeCloseTo(100, 9);
      }
    }
    expect(applyStreakBonus(getBaseRarityWeights(["common"]), ["common"], 5)).toEqual(getBaseRarityWeights(["common"]));
  });

  it("still boosts only the unlocked rare+ tiers when some are locked", () => {
    const base = withStreak(10, 0); // common, uncommon, rare unlocked
    const boosted = withStreak(10, 3);
    expect(boosted.rare).toBeGreaterThan(base.rare);
    expect(boosted.epic).toBe(0);
    expect(boosted.legendary).toBe(0);
  });

  it("does not bypass pity: pity is added on top of the boosted legendary weight", () => {
    const noPity = withStreak(20, 3, 0);
    const pity = withStreak(20, 3, 200);
    expect(pity.legendary - noPity.legendary).toBeCloseTo(2 - 0.5, 9); // exactly the pity delta
    expect(total(pity)).toBeCloseTo(100, 9);
    // And the boosted weights never replace the pity band: pity 49 vs 50 still differs by 0.25.
    expect(withStreak(20, 3, 50).legendary - withStreak(20, 3, 49).legendary).toBeCloseTo(0.25, 9);
  });

  it("does not touch the pity counter or locked-legendary behaviour", () => {
    expect(withStreak(19, 3, 500).legendary).toBe(0);
  });

  it("reaches rollCatch through the save", () => {
    const save = { ...saveWithDiscovered(20), minigame: { perfectStreak: 3 } };
    expect(getSaveRarityWeights(save)).toEqual(getRarityWeights(discovered(20), 0, 0, 3));
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

});
