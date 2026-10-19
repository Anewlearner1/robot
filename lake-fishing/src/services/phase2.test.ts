/**
 * PHASE-2 checklist tests (docs/phases/PHASE-2-tasks.md sections 4 and 6), grouped by task id.
 * Expectations here are written out by hand (cost table, weights, boundaries) rather than read
 * back from the data files, so a wrong edit to the data or to a formula fails a test.
 * No test relies on the real Math.random.
 */
import { describe, expect, it } from "vitest";
import { EQUIPMENT, getEquipmentEffect } from "../data/equipment";
import { FISH } from "../data/fish";
import type { EquipmentType, FishDefinition, FishRarity, GameSave } from "../types/game";
import {
  applyCatch,
  keepPending,
  sellAllInventory,
  sellAllPending,
  sellInventoryFish,
  sellPending
} from "./catchService";
import { describeEquipmentUpgrade, tryUpgradeEquipment, upgradeEquipment } from "./economyService";
import { getEncyclopediaEntries } from "./encyclopediaService";
import { GameLogicError } from "./errors";
import {
  chooseFishForRarity,
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
import type { RarityWeights } from "./fishingService";
import { settleOffline } from "./offlineService";
import { createNewSave, validateSave } from "./saveService";
import { FISH_IDS, saveWithDiscovered, seededRng, sequenceRng } from "./testUtils";
import { assertValidFish, getFishDataIssues } from "./validationService";
import economySource from "./economyService.ts?raw";
import catchSource from "./catchService.ts?raw";
import fishingSource from "./fishingService.ts?raw";
import offlineSource from "./offlineService.ts?raw";

// --- helpers --------------------------------------------------------------------------------

const sum = (weights: RarityWeights) => RARITY_ORDER.reduce((total, rarity) => total + weights[rarity], 0);
const discovered = (n: number) => FISH_IDS.slice(0, n);
const NOW = 7_000_000;
const EPS = 1e-9;

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as object)) deepFreeze(child);
  }
  return value;
}

/** An rng that counts how often it was called. */
function countingRng(values: number[]) {
  const next = sequenceRng(values);
  const state = { calls: 0 };
  return { rng: () => (state.calls++, next()), state };
}

const idsOf = (rarity: FishRarity) => FISH.filter((fish) => fish.rarity === rarity).map((fish) => fish.id);

/** The carp family from DESIGN.md, written out by hand (not read from GAME_CONFIG). */
const CARP_FAMILY = new Set([
  "fish_crucian_carp", "fish_carp", "fish_gibel", "fish_koi_gibel",
  "fish_silver_gibel", "fish_golden_carp", "fish_koi", "fish_moonlight_carp"
]);
const BAIT_MULTIPLIERS = [1, 1.2, 1.4, 1.6, 1.8, 2];

const catchFish = (save: GameSave, id: string, source: "active" | "offline" | "minigame" = "active") =>
  applyCatch(save, id, { source, now: NOW });

/** Run `fn` with the temporary mutation `mutate`, always restoring it afterwards. */
function withTemporarily<T>(mutate: () => () => void, fn: () => T): T {
  const restore = mutate();
  try {
    return fn();
  } finally {
    restore();
  }
}

// --- PH2-01 ----------------------------------------------------------------------------------

describe("PH2-01 unlock thresholds and probability normalisation", () => {
  it.each([
    [0, 1], [4, 1], [5, 2], [9, 2], [10, 3], [14, 3], [15, 4], [19, 4], [20, 5], [25, 5]
  ])("with %i discovered species exactly the first %i rarities are unlocked", (count, tiers) => {
    expect(getUnlockedRarities(discovered(count))).toEqual(RARITY_ORDER.slice(0, tiers));
  });

  it("a new game can only roll common", () => {
    const fresh = createNewSave(1);
    expect(getSaveRarityWeights(fresh)).toEqual({ common: 100, uncommon: 0, rare: 0, epic: 0, legendary: 0 });
  });

  it("the catch that reaches 5 / 10 / 15 / 20 species unlocks exactly the next rarity, no earlier", () => {
    let save = createNewSave(1);
    const unlockedAt: Record<number, FishRarity[]> = {};
    FISH_IDS.forEach((id, index) => {
      const { save: next, event } = catchFish(save, id);
      save = next;
      const count = index + 1;
      if (event.newlyUnlockedRarities.length > 0) unlockedAt[count] = event.newlyUnlockedRarities;
      expect(getUnlockedRarities(save.discoveredFishIds)).toEqual(
        RARITY_ORDER.slice(0, count >= 20 ? 5 : count >= 15 ? 4 : count >= 10 ? 3 : count >= 5 ? 2 : 1)
      );
    });
    expect(unlockedAt).toEqual({ 5: ["uncommon"], 10: ["rare"], 15: ["epic"], 20: ["legendary"] });
  });

  it("base weights are 60 / 25 / 11 / 3.5 / 0.5 and total exactly 100 when everything is unlocked", () => {
    const w = getBaseRarityWeights([...RARITY_ORDER]);
    [w.common, w.uncommon, w.rare, w.epic, w.legendary].forEach((value, index) => expect(value).toBeCloseTo([60, 25, 11, 3.5, 0.5][index], 12));
    expect(Math.abs(sum(w) - 100)).toBeLessThan(EPS);
  });

  it("every species count 0..25 x line 0..0.10 x pity (incl. all bands) x streak: locked = 0, unlocked total 100 within 1e-9", () => {
    const streakConfig = { streakBonusPerPerfect: 0.1, streakBonusMax: 0.3 };
    const pities = [0, 1, 49, 50, 99, 100, 149, 150, 199, 200, 201, 5000];
    const lines = [0, 0.02, 0.04, 0.06, 0.08, 0.1];
    for (let count = 0; count <= 25; count++) {
      const unlocked = getUnlockedRarities(discovered(count));
      for (const pity of pities) {
        for (const line of lines) {
          for (const streak of [0, 2, 99]) {
            const w = getRarityWeights(discovered(count), pity, line, streak, streakConfig);
            const label = `${count} fish, pity ${pity}, line ${line}, streak ${streak}`;
            expect(Math.abs(sum(w) - 100), label).toBeLessThan(EPS);
            for (const rarity of RARITY_ORDER) {
              expect(Number.isFinite(w[rarity]), label).toBe(true);
              expect(w[rarity], label).toBeGreaterThanOrEqual(0);
              if (!unlocked.includes(rarity)) expect(w[rarity], `${label} ${rarity}`).toBe(0);
            }
          }
        }
      }
    }
  });

  describe("invalid configured weights (negative, NaN, infinite, none valid)", () => {
    const all = [...RARITY_ORDER];

    it.each([
      ["negative", -5],
      ["NaN", Number.NaN],
      ["+Infinity", Infinity],
      ["-Infinity", -Infinity]
    ])("a %s weight counts as 0 and the rest still total 100", (_name, bad) => {
      const w = getBaseRarityWeights(all, { common: 60, uncommon: bad, rare: 11, epic: 3.5, legendary: 0.5 });
      expect(w.uncommon).toBe(0);
      expect(Math.abs(sum(w) - 100)).toBeLessThan(EPS);
      expect(w.common).toBeCloseTo((60 / 75) * 100, 9);
    });

    it("with no valid weight every weight is 0 and pickRarity throws a typed error without drawing", () => {
      const w = getBaseRarityWeights(all, { common: -1, uncommon: Number.NaN, rare: 0, epic: -0.5, legendary: Infinity });
      expect(sum(w)).toBe(0);
      const { rng, state } = countingRng([0.5]);
      let error: unknown;
      try {
        pickRarity(w, rng);
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(GameLogicError);
      expect(error).toBeInstanceOf(Error);
      expect((error as GameLogicError).code).toBe("NO_VALID_RARITY_WEIGHTS");
      expect(state.calls).toBe(0);
    });

    it("an unlocked list without any valid weight is also all zero (not a silent fall back to common)", () => {
      const onlyBad = { common: -1, uncommon: 25, rare: 11, epic: 3.5, legendary: 0.5 };
      expect(sum(getBaseRarityWeights(["common"], onlyBad))).toBe(0);
      expect(sum(getBaseRarityWeights([], onlyBad))).toBe(0);
    });

    it("pickRarity never returns a rarity whose weight is negative, NaN, infinite or 0", () => {
      const weights = { common: -3, uncommon: Number.NaN, rare: 0, epic: 40, legendary: Infinity } as RarityWeights;
      for (let i = 0; i <= 100; i++) expect(pickRarity(weights, () => i / 100)).toBe("epic");
    });

    it("pickRarity normalises weights that do not total 100", () => {
      const weights = { common: 2, uncommon: 2, rare: 0, epic: 0, legendary: 0 };
      expect(pickRarity(weights, () => 0.49)).toBe("common");
      expect(pickRarity(weights, () => 0.5)).toBe("uncommon");
    });

    it("a non-finite random() value throws INVALID_RANDOM_VALUE; out-of-range finite values are clamped", () => {
      const w = getRarityWeights(discovered(20));
      for (const bad of [Number.NaN, Infinity, -Infinity, undefined as unknown as number]) {
        expect(() => pickRarity(w, () => bad)).toThrowError(expect.objectContaining({ code: "INVALID_RANDOM_VALUE" }));
        expect(() => chooseFishForRarity("common", () => bad)).toThrowError(expect.objectContaining({ code: "INVALID_RANDOM_VALUE" }));
      }
      expect(pickRarity(w, () => -4)).toBe("common");
      expect(pickRarity(w, () => 7)).toBe("legendary");
    });
  });
});

// --- PH2-02 ----------------------------------------------------------------------------------

describe("PH2-02 rolling and catch settlement", () => {
  describe("fixed random(): every rarity interval, including exact boundaries (all unlocked, 60/25/11/3.5/0.5)", () => {
    // cumulative: common [0,.60), uncommon [.60,.85), rare [.85,.96), epic [.96,.995), legendary [.995,1)
    it.each<[number, FishRarity]>([
      [0, "common"], [0.3, "common"], [0.5999999999, "common"],
      [0.6, "uncommon"], [0.7, "uncommon"], [0.8499999999, "uncommon"],
      [0.85, "rare"], [0.9, "rare"], [0.9599999999, "rare"],
      [0.96, "epic"], [0.98, "epic"], [0.9949999999, "epic"],
      [0.995, "legendary"], [0.9999999999, "legendary"]
    ])("random() = %f -> %s", (roll, rarity) => {
      const weights = getRarityWeights(discovered(20));
      expect(pickRarity(weights, () => roll)).toBe(rarity);
      // The same roll through the whole pipeline (rarity draw first, then any fish draw).
      expect(rollCatch(saveWithDiscovered(20), sequenceRng([roll, 0])).rarity).toBe(rarity);
    });

    it("rolls land on the boundary of every unlock stage, with line and pity applied", () => {
      const cases: [number, number, number][] = [
        [0, 0, 0], [5, 0, 0], [5, 0, 0.1], [10, 0, 0.06], [15, 0, 0.1], [20, 0, 0], [20, 49, 0],
        [20, 50, 0.1], [20, 100, 0.04], [20, 150, 0.1], [20, 200, 0.1], [20, 200, 0]
      ];
      for (const [count, pity, line] of cases) {
        const w = getRarityWeights(discovered(count), pity, line);
        const total = sum(w);
        const available = RARITY_ORDER.filter((rarity) => w[rarity] > 0);
        let cumulative = 0;
        available.forEach((rarity, index) => {
          cumulative += w[rarity];
          const label = `${count} fish, pity ${pity}, line ${line}, ${rarity}`;
          expect(pickRarity(w, () => (cumulative - EPS * total) / total), label).toBe(rarity);
          if (index + 1 < available.length) {
            expect(pickRarity(w, () => (cumulative + EPS * total) / total), label).toBe(available[index + 1]);
          }
        });
      }
    });
  });

  describe("fixed random(): choosing the fish inside a rarity", () => {
    const rarities: FishRarity[] = ["common", "uncommon", "rare", "epic", "legendary"];

    it.each(BAIT_MULTIPLIERS.flatMap((multiplier, index) => rarities.map((rarity) => [index + 1, multiplier, rarity] as const)))(
      "bait Lv%i (x%f), %s: each fish owns its hand-computed interval, boundaries belong to the next fish",
      (baitLevel, multiplier, rarity) => {
        const pool = FISH.filter((fish) => fish.rarity === rarity);
        const weights = pool.map((fish) => (CARP_FAMILY.has(fish.id) ? multiplier : 1));
        const total = weights.reduce((a, b) => a + b, 0);
        let cumulative = 0;
        pool.forEach((fish, index) => {
          const start = cumulative / total;
          cumulative += weights[index];
          const end = cumulative / total;
          const label = `${rarity} ${fish.id}`;
          expect(chooseFishForRarity(rarity, () => (start + end) / 2, baitLevel).id, `${label} mid`).toBe(fish.id);
          expect(chooseFishForRarity(rarity, () => start + EPS, baitLevel).id, `${label} start+`).toBe(fish.id);
          expect(chooseFishForRarity(rarity, () => end - EPS, baitLevel).id, `${label} end-`).toBe(fish.id);
          if (index + 1 < pool.length) {
            expect(chooseFishForRarity(rarity, () => end + EPS, baitLevel).id, `${label} end+`).toBe(pool[index + 1].id);
          }
        });
      }
    );

    it("exact values: epic at bait Lv6 has weights 2 / 1 / 1 (moonlight carp is in the carp family)", () => {
      expect(idsOf("epic")).toEqual(["fish_moonlight_carp", "fish_starry_trout", "fish_jade_dragonfish"]);
      const pick = (roll: number) => chooseFishForRarity("epic", () => roll, 6).id;
      expect(pick(0)).toBe("fish_moonlight_carp");
      expect(pick(0.49)).toBe("fish_moonlight_carp");
      expect(pick(0.5)).toBe("fish_starry_trout"); // 0.5 * 4 = 2 sits exactly on the boundary
      expect(pick(0.74)).toBe("fish_starry_trout");
      expect(pick(0.75)).toBe("fish_jade_dragonfish");
      expect(pick(0.999)).toBe("fish_jade_dragonfish");
    });

    it("exact values: legendary has no bait target, so 0.5 splits it evenly at every bait level", () => {
      for (let bait = 1; bait <= 6; bait++) {
        expect(chooseFishForRarity("legendary", () => 0.49, bait).id).toBe("fish_lake_guardian");
        expect(chooseFishForRarity("legendary", () => 0.5, bait).id).toBe("fish_moonshadow");
      }
    });

    it("rollCatch spends exactly two draws: the first picks the rarity, the second the fish", () => {
      const save = { ...saveWithDiscovered(20), equipmentLevels: { rod: 1, line: 1, bait: 6 } };
      // 0.85 -> rare; second draw 0.3 over rare weights 2/2/1/1/1 (total 7): 0.3 * 7 = 2.1 -> koi
      const { rng, state } = countingRng([0.85, 0.3]);
      expect(rollCatch(save, rng).id).toBe("fish_koi");
      expect(state.calls).toBe(2);
    });
  });

  it("rollCatch only ever returns catalogue entries of an unlocked rarity", () => {
    const rng = seededRng(42);
    for (const count of [0, 5, 10, 15, 20]) {
      const save = saveWithDiscovered(count);
      const unlocked = getUnlockedRarities(save.discoveredFishIds);
      for (let i = 0; i < 400; i++) {
        const fish = rollCatch(save, rng);
        expect(FISH).toContain(fish); // the very same static object, never a copy
        expect(unlocked).toContain(fish.rarity);
      }
    }
  });

  describe("empty pool and invalid fish data", () => {
    it("an empty pool throws EMPTY_FISH_POOL and never consumes a random draw", () => {
      const { rng, state } = countingRng([0.5]);
      expect(() => chooseFishForRarity("rare", rng, 1, [])).toThrowError(expect.objectContaining({ code: "EMPTY_FISH_POOL" }));
      expect(state.calls).toBe(0);
    });

    it("a pool without any fish of the rolled rarity throws EMPTY_FISH_POOL", () => {
      const commonsOnly = FISH.filter((fish) => fish.rarity === "common");
      expect(() => chooseFishForRarity("epic", () => 0.5, 1, commonsOnly)).toThrow(GameLogicError);
      expect(getFishPickChances("epic", 1, [], commonsOnly)).toEqual([]);
      expect(chooseFishForRarity("common", () => 0, 1, commonsOnly).rarity).toBe("common"); // a valid pool still works
    });

    const base = FISH[0];
    it.each<[string, Partial<Record<keyof FishDefinition, unknown>>]>([
      ["NaN price", { sellPrice: Number.NaN }],
      ["negative price", { sellPrice: -1 }],
      ["fractional price", { sellPrice: 2.5 }],
      ["infinite price", { sellPrice: Infinity }],
      ["empty id", { id: "" }],
      ["non-boolean autoSell", { autoSell: "yes" }],
      ["unknown rarity", { rarity: "mythic" }]
    ])("assertValidFish rejects %s with INVALID_FISH_DATA", (_name, patch) => {
      const broken = { ...base, ...patch };
      expect(getFishDataIssues(broken).length).toBeGreaterThan(0);
      expect(() => assertValidFish(broken)).toThrowError(expect.objectContaining({ code: "INVALID_FISH_DATA" }));
    });

    it("assertValidFish accepts every catalogue fish and rejects non-objects", () => {
      for (const fish of FISH) expect(getFishDataIssues(fish), fish.id).toEqual([]);
      for (const junk of [null, undefined, 5, "fish_carp"]) expect(getFishDataIssues(junk)).not.toEqual([]);
    });

    it("chooseFishForRarity refuses a pool containing an invalid candidate of that rarity", () => {
      const pool = [...FISH.filter((fish) => fish.rarity === "common"), { ...base, id: "fish_broken", sellPrice: Number.NaN }];
      expect(() => chooseFishForRarity("common", () => 0.1, 1, pool)).toThrowError(expect.objectContaining({ code: "INVALID_FISH_DATA" }));
    });

    it("applyCatch throws UNKNOWN_FISH_ID for ids outside the catalogue and leaves the save alone", () => {
      const save = deepFreeze(saveWithDiscovered(20));
      for (const id of ["fish_cultrure", "", "nope", "__proto__", "toString"]) {
        expect(() => catchFish(save, id), id).toThrowError(expect.objectContaining({ code: "UNKNOWN_FISH_ID" }));
      }
    });

    it("applyCatch throws INVALID_FISH_DATA, before changing anything, if a catalogue entry is corrupt", () => {
      const save = deepFreeze(saveWithDiscovered(20));
      const carp = FISH.find((fish) => fish.id === "fish_carp")!;
      for (const [field, value] of [["sellPrice", Number.NaN], ["sellPrice", -8], ["autoSell", undefined]] as const) {
        withTemporarily(
          () => {
            const original = carp[field];
            (carp as unknown as Record<string, unknown>)[field] = value;
            return () => void ((carp as unknown as Record<string, unknown>)[field] = original);
          },
          () => expect(() => catchFish(save, carp.id), `${field}=${String(value)}`).toThrowError(expect.objectContaining({ code: "INVALID_FISH_DATA" }))
        );
      }
      expect(carp.sellPrice).toBe(8);
      expect(catchFish(save, carp.id).event.coinsEarned).toBe(8); // restored data works again
    });
  });

  describe("rare and above are never auto-sold", () => {
    it.each(FISH.map((fish) => [fish.id, fish.rarity, fish.autoSell] as const))(
      "%s (%s): auto-sold iff autoSell",
      (id, rarity, autoSell) => {
        const start = saveWithDiscovered(20);
        const { save, event } = catchFish(start, id);
        const shouldSell = rarity === "common" || rarity === "uncommon";
        expect(autoSell).toBe(shouldSell);
        expect(event.outcome).toBe(shouldSell ? "sold" : "pending");
        expect(save.stats.totalFishSold).toBe(start.stats.totalFishSold + (shouldSell ? 1 : 0));
        expect(save.coins).toBe(shouldSell ? FISH.find((fish) => fish.id === id)!.sellPrice : 0);
        expect(save.pendingFish.reduce((n, row) => n + row.quantity, 0)).toBe(shouldSell ? 0 : 1);
      }
    );
  });

  describe("the input save is never mutated (deep-frozen inputs)", () => {
    const frozenRich = () =>
      deepFreeze({ ...saveWithDiscovered(20), coins: 5_000, pity: { consecutiveNonLegendary: 60 }, minigame: { perfectStreak: 2 } });

    it("applyCatch: auto-sell, new pending row, merged pending row, new discovery, legendary, every minigame result", () => {
      const results = ["perfect", "success", "miss", "none"] as const;
      for (const result of results) {
        for (const id of ["fish_carp", "fish_catfish", "fish_koi", "fish_moonlight_carp", "fish_lake_guardian"]) {
          const frozen = frozenRich();
          const snapshot = JSON.stringify(frozen);
          const out = applyCatch(frozen, id, { source: "minigame", now: NOW, minigame: { result } });
          expect(out.save).not.toBe(frozen);
          expect(JSON.stringify(frozen), `${id} ${result}`).toBe(snapshot);
          // merging into an existing (frozen) pending row
          const merged = applyCatch(deepFreeze(out.save), id, { source: "minigame", now: NOW + 1, minigame: { result } });
          expect(merged.save.stats.totalCatches).toBe(out.save.stats.totalCatches + 1);
        }
      }
      const fresh = deepFreeze(createNewSave(1));
      expect(catchFish(fresh, "fish_carp").save.discoveredFishIds).toEqual(["fish_carp"]);
      expect(fresh.discoveredFishIds).toEqual([]);
    });

    it("rollCatch, selling, keeping, upgrading and offline settlement leave their input untouched", () => {
      const caught = [0, 1, 2].reduce((save) => catchFish(save, "fish_koi").save, frozenRich());
      const withKept = { ...caught, fishInventory: { fish_sturgeon: 3 } };
      const frozen = deepFreeze(withKept);
      const snapshot = JSON.stringify(frozen);
      const rowId = frozen.pendingFish[0].id;

      rollCatch(frozen, seededRng(1));
      sellPending(frozen, rowId, 2);
      sellPending(frozen, rowId);
      sellPending(frozen, rowId, 99); // refused
      keepPending(frozen, rowId, 1);
      sellInventoryFish(frozen, "fish_sturgeon", 2);
      sellInventoryFish(frozen, "fish_sturgeon", 0); // refused
      sellAllPending(frozen);
      sellAllInventory(frozen);
      for (const type of ["rod", "line", "bait"] as const) upgradeEquipment(frozen, type);
      upgradeEquipment(deepFreeze({ ...createNewSave(1) }), "rod"); // refused
      settleOffline(frozen, frozen.lastOfflineSettlementAt + 3_600_000, seededRng(5));
      expect(JSON.stringify(frozen)).toBe(snapshot);
    });
  });

  describe("each catch settles exactly once", () => {
    it("one applyCatch changes every counter by exactly one catch, for a sold and for a pending fish", () => {
      const start = deepFreeze(saveWithDiscovered(20));
      const sold = catchFish(start, "fish_carp").save;
      expect(sold.stats).toEqual({ ...start.stats, totalCatches: start.stats.totalCatches + 1, totalFishSold: start.stats.totalFishSold + 1, totalCoinsEarned: 8 });
      expect(sold.catchCounts).toEqual({ ...start.catchCounts, fish_carp: start.catchCounts.fish_carp + 1 });
      expect(sold.coins).toBe(8);
      expect(sold.discoveredFishIds).toEqual(start.discoveredFishIds); // a repeat is not a new species
      expect(sold.pity.consecutiveNonLegendary).toBe(1);

      const pending = catchFish(start, "fish_koi").save;
      expect(pending.stats.totalCatches).toBe(start.stats.totalCatches + 1);
      expect(pending.stats.totalFishSold).toBe(start.stats.totalFishSold);
      expect(pending.coins).toBe(0);
      expect(pending.pendingFish.reduce((n, row) => n + row.quantity, 0)).toBe(1);
      expect(pending.pity.consecutiveNonLegendary).toBe(1);
    });

    it("the same input settled twice gives two identical results: there is no hidden state to double count", () => {
      const start = deepFreeze(saveWithDiscovered(20));
      expect(catchFish(start, "fish_koi")).toEqual(catchFish(start, "fish_koi"));
    });

    it("one roll + one apply per countdown: 500 seeded catches total exactly 500 in every counter", () => {
      const rng = seededRng(2025);
      const start = { ...saveWithDiscovered(20), stats: { totalCatches: 0, totalFishSold: 0, totalCoinsEarned: 0 }, catchCounts: {} };
      let save: GameSave = start;
      let expectedCoins = 0;
      let pendingFish = 0;
      for (let i = 0; i < 500; i++) {
        const fish = rollCatch(save, rng);
        const out = applyCatch(save, fish.id, { source: "active", now: NOW + i });
        save = out.save;
        if (out.event.outcome === "sold") expectedCoins += fish.sellPrice;
        else pendingFish++;
      }
      expect(save.stats.totalCatches).toBe(500);
      expect(Object.values(save.catchCounts).reduce((a, b) => a + b, 0)).toBe(500);
      expect(save.stats.totalFishSold + pendingFish).toBe(500);
      expect(save.pendingFish.reduce((n, row) => n + row.quantity, 0)).toBe(pendingFish);
      expect(save.coins).toBe(expectedCoins);
      expect(save.stats.totalCoinsEarned).toBe(expectedCoins);
      expect(validateSave(save)).toBe(true);
    });
  });
});

// --- PH2-03 ----------------------------------------------------------------------------------

describe("PH2-03 coin economy and selling", () => {
  /** 5 koi (50 each) pending in one merged row, plus 4 sturgeon (45 each) kept, plus 123 coins. */
  const holding = () => {
    let save = saveWithDiscovered(20);
    for (let i = 0; i < 5; i++) save = catchFish(save, "fish_koi").save;
    return deepFreeze({ ...save, coins: 123, fishInventory: { fish_sturgeon: 4 } });
  };
  const rowOf = (save: GameSave) => save.pendingFish[0];
  const snapshot = (save: GameSave) => ({
    coins: save.coins,
    pending: save.pendingFish,
    inventory: save.fishInventory,
    stats: save.stats,
    discovered: save.discoveredFishIds,
    catchCounts: save.catchCounts
  });

  it.each([[1, 50], [2, 100], [3, 150], [5, 250]])("selling %i of the 5 pending koi pays %i and nothing else changes", (qty, coins) => {
    const save = holding();
    const result = sellPending(save, rowOf(save).id, qty);
    if (!result.ok) throw new Error("unreachable");
    expect(result).toMatchObject({ soldCount: qty, coinsEarned: coins });
    expect(result.save.coins).toBe(123 + coins);
    expect(result.save.stats.totalFishSold).toBe(save.stats.totalFishSold + qty);
    expect(result.save.stats.totalCoinsEarned).toBe(save.stats.totalCoinsEarned + coins);
    expect(result.save.pendingFish.reduce((n, row) => n + row.quantity, 0)).toBe(5 - qty);
    expect(result.save.fishInventory).toEqual({ fish_sturgeon: 4 });
  });

  it.each([[1, 45], [3, 135], [4, 180]])("selling %i of the 4 kept sturgeon pays %i", (qty, coins) => {
    const result = sellInventoryFish(holding(), "fish_sturgeon", qty);
    if (!result.ok) throw new Error("unreachable");
    expect(result).toMatchObject({ soldCount: qty, coinsEarned: coins });
    expect(result.save.coins).toBe(123 + coins);
    expect(result.save.fishInventory.fish_sturgeon ?? 0).toBe(4 - qty);
  });

  const badQuantities: [string, number, string][] = [
    ["0", 0, "INVALID_QUANTITY"],
    ["-1", -1, "INVALID_QUANTITY"],
    ["-0.5", -0.5, "INVALID_QUANTITY"],
    ["1.5", 1.5, "INVALID_QUANTITY"],
    ["NaN", Number.NaN, "INVALID_QUANTITY"],
    ["Infinity", Infinity, "INVALID_QUANTITY"],
    ["-Infinity", -Infinity, "INVALID_QUANTITY"],
    ["a string", "2" as unknown as number, "INVALID_QUANTITY"],
    ["above the safe-integer range", Number.MAX_SAFE_INTEGER + 2, "INVALID_QUANTITY"],
    ["more than held", 6, "INSUFFICIENT_QUANTITY"],
    ["far more than held", 1_000_000, "INSUFFICIENT_QUANTITY"]
  ];

  it.each(badQuantities)("sellPending refuses a quantity of %s and coins, fish counts and stats stay identical", (_name, qty, reason) => {
    const save = holding();
    const before = snapshot(save);
    const result = sellPending(save, rowOf(save).id, qty);
    expect(result).toEqual({ ok: false, reason, save });
    expect(result.save).toBe(save);
    expect(snapshot(result.save)).toEqual(before);
  });

  it.each(badQuantities.map(([name, qty, reason]) => [name, qty, reason === "INSUFFICIENT_QUANTITY" ? "INSUFFICIENT_QUANTITY" : reason] as const))(
    "sellInventoryFish refuses a quantity of %s and coins, fish counts and stats stay identical",
    (_name, qty, reason) => {
      const save = holding();
      const before = snapshot(save);
      const expectedReason = qty === 6 || qty === 1_000_000 ? "INSUFFICIENT_QUANTITY" : reason; // held is 4 here
      const result = sellInventoryFish(save, "fish_sturgeon", qty);
      expect(result).toEqual({ ok: false, reason: expectedReason, save });
      expect(snapshot(result.save)).toEqual(before);
    }
  );

  it("quantity 5 is accepted but 5 of the 4 kept sturgeon is not (the limit is the amount held)", () => {
    const save = holding();
    expect(sellInventoryFish(save, "fish_sturgeon", 4).ok).toBe(true);
    expect(sellInventoryFish(save, "fish_sturgeon", 5)).toMatchObject({ ok: false, reason: "INSUFFICIENT_QUANTITY" });
    expect(sellPending(save, rowOf(save).id, 5).ok).toBe(true);
    expect(sellPending(save, rowOf(save).id, 6)).toMatchObject({ ok: false, reason: "INSUFFICIENT_QUANTITY" });
  });

  it("a pending record cannot be sold twice, not even partially past what is left", () => {
    const save = holding();
    const id = rowOf(save).id;
    const first = sellPending(save, id, 3);
    if (!first.ok) throw new Error("unreachable");
    expect(sellPending(first.save, id, 3)).toMatchObject({ ok: false, reason: "INSUFFICIENT_QUANTITY" }); // only 2 left
    const second = sellPending(first.save, id, 2);
    if (!second.ok) throw new Error("unreachable");
    expect(second.save.coins).toBe(123 + 250); // exactly 5 koi in total, never more
    for (const again of [sellPending(second.save, id), sellPending(second.save, id, 1), keepPending(second.save, id)]) {
      expect(again).toMatchObject({ ok: false, reason: "NOT_FOUND" });
      expect(again.save.coins).toBe(123 + 250);
    }
  });

  it("a record that was kept can no longer be sold from the pending list, and sell-all is a no-op the second time", () => {
    const save = holding();
    const id = rowOf(save).id;
    const kept = keepPending(save, id);
    if (!kept.ok) throw new Error("unreachable");
    expect(sellPending(kept.save, id)).toMatchObject({ ok: false, reason: "NOT_FOUND" });
    expect(kept.save.fishInventory.fish_koi).toBe(5);

    const all = sellAllPending(save);
    if (!all.ok) throw new Error("unreachable");
    expect(all.coinsEarned).toBe(250);
    expect(sellAllPending(all.save)).toMatchObject({ ok: false, reason: "NOTHING_TO_SELL" });
    expect(all.save.coins).toBe(123 + 250);
  });

  it("selling, keeping and selling everything never touch the encyclopedia", () => {
    const save = holding();
    const id = rowOf(save).id;
    const entries = getEncyclopediaEntries(save);
    const outcomes = [
      sellPending(save, id, 2),
      sellPending(save, id),
      keepPending(save, id, 3),
      sellInventoryFish(save, "fish_sturgeon", 4),
      sellAllPending(save),
      sellAllInventory(save)
    ];
    for (const outcome of outcomes) {
      if (!outcome.ok) throw new Error("unreachable");
      expect(outcome.save.discoveredFishIds).toEqual(save.discoveredFishIds);
      expect(outcome.save.catchCounts).toEqual(save.catchCounts);
      expect(outcome.save.stats.totalCatches).toBe(save.stats.totalCatches);
      expect(getEncyclopediaEntries(outcome.save)).toEqual(entries);
    }
  });

  it("fuzz: 800 random catch / sell / keep / sell-all / upgrade steps (bad quantities included) keep every invariant", () => {
    const rng = seededRng(77);
    const pick = <T,>(items: readonly T[]) => items[Math.floor(rng() * items.length)];
    const quantities = [1, 2, 3, 0, -1, 1.5, Number.NaN, 50];
    let save: GameSave = { ...saveWithDiscovered(20), stats: { totalCatches: 20, totalFishSold: 20, totalCoinsEarned: 0 } };
    let spent = 0;
    for (let step = 0; step < 800; step++) {
      const action = Math.floor(rng() * 7);
      if (action <= 1) {
        save = applyCatch(save, rollCatch(save, rng).id, { source: "active", now: NOW + step }).save;
      } else if (action === 2 && save.pendingFish.length > 0) {
        const result = sellPending(save, pick(save.pendingFish).id, pick(quantities));
        save = result.save;
      } else if (action === 3 && save.pendingFish.length > 0) {
        save = keepPending(save, pick(save.pendingFish).id, pick(quantities)).save;
      } else if (action === 4 && Object.keys(save.fishInventory).length > 0) {
        save = sellInventoryFish(save, pick(Object.keys(save.fishInventory)), pick(quantities)).save;
      } else if (action === 5) {
        save = (rng() < 0.5 ? sellAllPending(save) : sellAllInventory(save)).save;
      } else {
        const type = pick(["rod", "line", "bait"] as const);
        const result = upgradeEquipment(save, type);
        if (result.result.success) spent += save.coins - result.save.coins;
        save = result.save;
      }
      const pendingQty = save.pendingFish.reduce((n, row) => n + row.quantity, 0);
      const keptQty = Object.values(save.fishInventory).reduce((n, count) => n + count, 0);
      expect(Number.isSafeInteger(save.coins) && save.coins >= 0, `coins at step ${step}`).toBe(true);
      expect(save.pendingFish.every((row) => Number.isSafeInteger(row.quantity) && row.quantity > 0)).toBe(true);
      expect(Object.values(save.fishInventory).every((count) => Number.isSafeInteger(count) && count > 0)).toBe(true);
      // every fish is exactly one of: sold, pending, kept
      expect(save.stats.totalCatches - save.stats.totalFishSold, `fish conservation at step ${step}`).toBe(pendingQty + keptQty);
      expect(save.coins, `coin conservation at step ${step}`).toBe(save.stats.totalCoinsEarned - spent);
      expect(save.discoveredFishIds.length).toBeGreaterThanOrEqual(20);
    }
    expect(validateSave(save)).toBe(true);
  });
});

// --- PH2-04 ----------------------------------------------------------------------------------

describe("PH2-04 equipment effects and upgrades", () => {
  // PHASE-2 task doc / PRD section 7, written out by hand: cost of Lv.n -> Lv.n+1 for n = 1..5.
  const COSTS: Record<EquipmentType, number[]> = {
    rod: [100, 160, 260, 410, 660],
    line: [150, 240, 380, 610, 980],
    bait: [200, 320, 510, 820, 1310]
  };
  const steps = (Object.keys(COSTS) as EquipmentType[]).flatMap((type) =>
    COSTS[type].map((cost, index) => [type, index + 1, cost] as const)
  );

  it("there are exactly 15 upgrade steps and the data table holds exactly these costs", () => {
    expect(steps).toHaveLength(15);
    for (const type of Object.keys(COSTS) as EquipmentType[]) {
      const definition = EQUIPMENT.find((item) => item.id === type)!;
      expect(definition.maxLevel).toBe(6);
      expect(definition.levels.map((level) => level.upgradeCost)).toEqual([null, ...COSTS[type]]);
    }
  });

  it.each(steps)("%s: the step up from Lv.%i costs exactly %i, with one coin short, exactly enough, and plenty", (type, level, cost) => {
    // one short: refused, nothing changes
    expect(tryUpgradeEquipment(type, level, cost - 1)).toEqual({ success: false, reason: "INSUFFICIENT_COINS", coins: cost - 1, level });
    expect(tryUpgradeEquipment(type, level, 0)).toMatchObject({ success: false, reason: "INSUFFICIENT_COINS", coins: 0, level });
    // exactly enough: pays everything, gains exactly one level
    expect(tryUpgradeEquipment(type, level, cost)).toEqual({ success: true, coins: 0, level: level + 1 });
    // plenty: pays only the cost, still only one level
    expect(tryUpgradeEquipment(type, level, cost + 12_345)).toEqual({ success: true, coins: 12_345, level: level + 1 });

    // the same through a save: only that piece of equipment moves, stats are untouched
    const levels = { rod: 3, line: 3, bait: 3, [type]: level } as Record<EquipmentType, number>;
    const poor = deepFreeze({ ...createNewSave(1), coins: cost - 1, equipmentLevels: levels });
    const refused = upgradeEquipment(poor, type);
    expect(refused.save).toBe(poor);
    expect(refused.result.reason).toBe("INSUFFICIENT_COINS");
    const exact = upgradeEquipment(deepFreeze({ ...poor, coins: cost }), type);
    expect(exact.save.coins).toBe(0);
    expect(exact.save.equipmentLevels).toEqual({ ...levels, [type]: level + 1 });
    expect(exact.save.stats).toEqual(poor.stats);

    // the equipment screen shows the same cost / shortfall
    expect(describeEquipmentUpgrade(type, level, cost - 1)).toMatchObject({ cost, canAfford: false, shortfall: 1 });
    expect(describeEquipmentUpgrade(type, level, cost)).toMatchObject({ cost, canAfford: true, shortfall: 0 });
  });

  it.each(["rod", "line", "bait"] as const)("%s at Lv.6 cannot be upgraded, with any amount of coins, and the save is unchanged", (type) => {
    expect(tryUpgradeEquipment(type, 6, 1_000_000)).toEqual({ success: false, reason: "MAX_LEVEL", coins: 1_000_000, level: 6 });
    const save = deepFreeze({ ...createNewSave(1), coins: 1_000_000, equipmentLevels: { rod: 6, line: 6, bait: 6 } });
    const result = upgradeEquipment(save, type);
    expect(result.save).toBe(save);
    expect(result.result.reason).toBe("MAX_LEVEL");
    expect(describeEquipmentUpgrade(type, 6, 1_000_000)).toMatchObject({ isMaxLevel: true, cost: null, canAfford: false });
  });

  it("a non-finite coin amount never buys an upgrade or produces a NaN balance", () => {
    for (const coins of [Number.NaN, Infinity, -Infinity, -5]) {
      expect(tryUpgradeEquipment("rod", 1, coins)).toMatchObject({ success: false, reason: "INSUFFICIENT_COINS", level: 1 });
    }
  });

  it("upgrading everything from Lv.1 to Lv.6 spends exactly the sum of the table, never more", () => {
    const total = Object.values(COSTS).flat().reduce((a, b) => a + b, 0);
    expect(total).toBe(100 + 160 + 260 + 410 + 660 + 150 + 240 + 380 + 610 + 980 + 200 + 320 + 510 + 820 + 1310);
    let save: GameSave = { ...createNewSave(1), coins: total + 7 };
    for (const type of ["rod", "line", "bait"] as const) {
      for (let i = 0; i < 5; i++) {
        const result = upgradeEquipment(save, type);
        expect(result.result.success).toBe(true);
        save = result.save;
      }
      expect(upgradeEquipment(save, type).result.reason).toBe("MAX_LEVEL");
    }
    expect(save.coins).toBe(7);
    expect(save.equipmentLevels).toEqual({ rod: 6, line: 6, bait: 6 });
  });

  describe("rod interval: Math.max(30, Math.round(90 * (1 - 0.08 * (rodLevel - 1))))", () => {
    it("equals the literal formula for Lv.1..6 and never drops below 30 seconds", () => {
      expect([1, 2, 3, 4, 5, 6].map((level) => getFishingIntervalSeconds(level))).toEqual([90, 83, 76, 68, 61, 54]);
      for (let level = 1; level <= 6; level++) {
        expect(getFishingIntervalSeconds(level)).toBe(Math.max(30, Math.round(90 * (1 - 0.08 * (level - 1)))));
      }
    });

    it("the 30 s floor holds for every combination of base, slope and level, matching the literal formula", () => {
      for (let base = 30; base <= 120; base += 10) {
        for (const slope of [0, 0.05, 0.08, 0.15, 0.2, 0.3]) {
          for (let level = 1; level <= 6; level++) {
            const seconds = getFishingIntervalSeconds(level, { baseIntervalSeconds: base, reductionPerLevel: slope, minimumIntervalSeconds: 30 });
            expect(seconds, `base ${base}, slope ${slope}, Lv.${level}`).toBe(Math.max(30, Math.round(base * (1 - slope * (level - 1)))));
            expect(seconds).toBeGreaterThanOrEqual(30);
          }
        }
      }
    });
  });

  describe("line and bait multipliers live in the data file only", () => {
    it("the bait multiplier is hand-checked at x1.0 .. x2.0 and the line effect at 0 .. 10 %", () => {
      expect([1, 2, 3, 4, 5, 6].map((level) => getEquipmentEffect("bait", level))).toEqual(BAIT_MULTIPLIERS);
      expect([1, 2, 3, 4, 5, 6].map((level) => getEquipmentEffect("line", level))).toEqual([0, 0.02, 0.04, 0.06, 0.08, 0.1]);
    });

    it("changing the line effect in the data changes the rarity weights, with no other edit", () => {
      const line = EQUIPMENT.find((item) => item.id === "line")!.levels[5];
      const save = { ...saveWithDiscovered(20), equipmentLevels: { rod: 1, line: 6, bait: 1 } };
      expect(getSaveRarityWeights(save).common).toBeCloseTo(50, 9);
      withTemporarily(
        () => {
          const original = line.effectValue;
          line.effectValue = 0.2;
          return () => void (line.effectValue = original);
        },
        () => expect(getSaveRarityWeights(save).common).toBeCloseTo(40, 9)
      );
      expect(getSaveRarityWeights(save).common).toBeCloseTo(50, 9);
    });

    it("changing the bait multiplier in the data changes the pick chances, with no other edit", () => {
      const bait = EQUIPMENT.find((item) => item.id === "bait")!.levels[5];
      const share = () =>
        getFishPickChances("epic", 6).find((entry) => entry.fish.id === "fish_moonlight_carp")!.chance;
      expect(share()).toBeCloseTo(2 / 4, 12);
      withTemporarily(
        () => {
          const original = bait.effectValue;
          bait.effectValue = 4;
          return () => void (bait.effectValue = original);
        },
        () => expect(share()).toBeCloseTo(4 / 6, 12)
      );
      expect(share()).toBeCloseTo(2 / 4, 12);
    });

    it("the service sources contain no hard-coded costs, line / bait / rod multipliers or interval constants", () => {
      const strip = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      const forbidden = [
        "0.08", "0.92", "0.84", "0.76", "0.68", "0.02", "0.04", "0.06",
        "1.2", "1.4", "1.6", "1.8", "160", "260", "410", "660", "150", "240", "380", "610", "980", "320", "510", "820", "1310"
      ];
      for (const [name, source] of Object.entries({ economySource, catchSource, fishingSource, offlineSource })) {
        const code = strip(source);
        for (const literal of forbidden) {
          expect(new RegExp(`(?<![\\w.])${literal.replace(".", "\\.")}(?![\\w.])`).test(code), `${name} contains ${literal}`).toBe(false);
        }
        expect(code.includes("Math.max(30"), `${name} hard-codes the 30 s floor`).toBe(false);
      }
    });
  });
});

// --- PH2-05 ----------------------------------------------------------------------------------

describe("PH2-05 legendary pity", () => {
  // [pity count, legendary chance in percent] - the five bands of PRD section 4, hand-written.
  const BOUNDARIES: [number, number][] = [
    [0, 0.5], [49, 0.5], [50, 0.75], [99, 0.75], [100, 1], [149, 1], [150, 1.5], [199, 1.5], [200, 2], [201, 2], [5000, 2]
  ];

  it.each(BOUNDARIES)("pity %i -> legendary %f %% and every unlocked weight still totals 100 (all line levels)", (pity, percent) => {
    expect(getLegendaryChance(pity) * 100).toBeCloseTo(percent, 12);
    for (const line of [0, 0.02, 0.04, 0.06, 0.08, 0.1]) {
      const w = getRarityWeights(discovered(20), pity, line);
      expect(Math.abs(sum(w) - 100), `pity ${pity}, line ${line}`).toBeLessThan(EPS);
    }
    const plain = getRarityWeights(discovered(20), pity, 0);
    expect(plain.legendary).toBeCloseTo(percent, 9);
    // the other four tiers keep their relative proportions (60 : 25 : 11 : 3.5)
    expect(plain.common / plain.uncommon).toBeCloseTo(60 / 25, 9);
    expect(plain.rare / plain.epic).toBeCloseTo(11 / 3.5, 9);
  });

  it.each([
    [49, 50, 0.9926],
    [99, 100, 0.9915],
    [149, 150, 0.9875],
    [199, 200, 0.9825]
  ])("a fixed roll of %f lands in the legendary band only from pity %i (49/50, 99/100, 149/150, 199/200)", (low, high, roll) => {
    const at = (pity: number) => rollCatch({ ...saveWithDiscovered(20), pity: { consecutiveNonLegendary: pity } }, sequenceRng([roll, 0])).rarity;
    expect(at(low)).toBe("epic");
    expect(at(high)).toBe("legendary");
  });

  it("a legendary resets the counter to 0 from every band, and the next roll uses the base 0.5 % again", () => {
    for (const [pity] of BOUNDARIES) {
      const start = { ...saveWithDiscovered(20), pity: { consecutiveNonLegendary: pity } };
      const { save, event } = catchFish(start, "fish_moonshadow");
      expect(save.pity.consecutiveNonLegendary, `pity ${pity}`).toBe(0);
      expect(event.pity).toEqual({ before: pity, after: 0, reset: true });
      expect(getSaveRarityWeights(save).legendary).toBeCloseTo(0.5, 9);
    }
  });

  it("every other catch adds exactly one once legendary is unlocked", () => {
    let save = saveWithDiscovered(20);
    for (let i = 1; i <= 205; i++) {
      save = catchFish(save, i % 2 ? "fish_carp" : "fish_koi").save;
      expect(save.pity.consecutiveNonLegendary).toBe(i);
    }
    expect(getSaveRarityWeights(save).legendary).toBeCloseTo(2, 9);
  });

  it.each([0, 5, 10, 15, 19])("with %i species (legendary locked) pity neither grows nor shrinks and the weights ignore it", (count) => {
    let save: GameSave = { ...saveWithDiscovered(count), pity: { consecutiveNonLegendary: 0 } };
    // repeat catches of species that are already known (a first catch would discover more and could unlock)
    for (const id of count === 0 ? ["fish_crucian_carp"] : discovered(count)) save = catchFish(save, id).save;
    for (const id of count === 0 ? ["fish_crucian_carp"] : discovered(count)) save = catchFish(save, id).save;
    expect(save.discoveredFishIds.length).toBe(Math.max(count, 1));
    expect(save.pity.consecutiveNonLegendary).toBe(0);
    for (const pity of [0, 49, 200, 5000]) {
      expect(getRarityWeights(save.discoveredFishIds, pity).legendary).toBe(0);
    }
    // settled offline as well (rng 0 always bites the first common fish): still untouched
    const away = settleOffline({ ...save, lastOfflineSettlementAt: 0 }, 4 * 3_600_000, sequenceRng([0, 0]));
    expect(away.summary.effectiveCatches).toBe(80);
    expect(away.save.discoveredFishIds.length).toBe(Math.max(count, 1));
    expect(away.save.pity.consecutiveNonLegendary).toBe(0);
  });

  it("the catch that unlocks legendary does not count; the next one does", () => {
    const at19 = saveWithDiscovered(19);
    const unlocked = catchFish(at19, FISH_IDS[19]);
    expect(unlocked.save.pity.consecutiveNonLegendary).toBe(0);
    expect(catchFish(unlocked.save, "fish_carp").save.pity.consecutiveNonLegendary).toBe(1);
  });

  it("changing equipment (success or refusal, every type, every band) does not reset or change the counter", () => {
    for (const [pity] of BOUNDARIES) {
      let save: GameSave = deepFreeze({ ...saveWithDiscovered(20), coins: 100_000, pity: { consecutiveNonLegendary: pity } });
      for (const type of ["rod", "line", "bait"] as const) {
        const upgraded = upgradeEquipment(save, type);
        expect(upgraded.result.success).toBe(true);
        expect(upgraded.save.pity.consecutiveNonLegendary, `${type} at pity ${pity}`).toBe(pity);
        save = deepFreeze(upgraded.save);
      }
      const broke = upgradeEquipment(deepFreeze({ ...save, coins: 0 }), "line");
      expect(broke.result.success).toBe(false);
      expect(broke.save.pity.consecutiveNonLegendary).toBe(pity);
      // the band is a function of the counter only: the same legendary share at base line, whatever the rod / bait
      const withGear = { ...save, equipmentLevels: { rod: 6, line: 1, bait: 6 } };
      expect(getSaveRarityWeights(withGear).legendary).toBeCloseTo(getLegendaryChance(pity) * 100, 9);
    }
  });
});
