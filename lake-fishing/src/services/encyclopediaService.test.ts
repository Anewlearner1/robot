import { describe, expect, it } from "vitest";
import { GAME_CONFIG } from "../data/gameConfig";
import type { FishRarity } from "../types/game";
import { applyCatch } from "./catchService";
import {
  getCollectionProgress,
  getEncyclopediaEntries,
  getKnownDiscoveredIds,
  getNextUnlock,
  getRarityUnlockThreshold
} from "./encyclopediaService";
import { getUnlockedRarities } from "./fishingService";
import { sellAllPending } from "./catchService";
import { FISH_IDS, saveWithDiscovered } from "./testUtils";

describe("encyclopedia", () => {
  it("counts only known, distinct ids (shared with unlock gating)", () => {
    const dirty = [...FISH_IDS.slice(0, 4), FISH_IDS[0], "fish_cultrure", "bogus"];
    expect(getKnownDiscoveredIds(dirty)).toEqual(FISH_IDS.slice(0, 4));
    expect(getCollectionProgress(dirty).discovered).toBe(4);
    // Raw length is 7, but unlocking must agree with the encyclopedia: still only 4.
    expect(getUnlockedRarities(dirty)).toEqual(["common"]);
  });

  it("reports progress as { discovered, total, percent }", () => {
    expect(getCollectionProgress([])).toEqual({ discovered: 0, total: 25, percent: 0 });
    expect(getCollectionProgress(FISH_IDS.slice(0, 10))).toEqual({ discovered: 10, total: 25, percent: 40 });
    expect(getCollectionProgress(FISH_IDS.slice(0, 1))).toEqual({ discovered: 1, total: 25, percent: 4 });
    expect(getCollectionProgress(FISH_IDS.slice(0, 24))).toEqual({ discovered: 24, total: 25, percent: 96 });
    expect(getCollectionProgress(FISH_IDS)).toEqual({ discovered: 25, total: 25, percent: 100 });
  });

  it("builds 25 entries with catch counts for discovered fish only", () => {
    const entries = getEncyclopediaEntries({
      discoveredFishIds: [FISH_IDS[2]],
      catchCounts: { [FISH_IDS[2]]: 7, [FISH_IDS[3]]: 4 }
    });
    expect(entries).toHaveLength(25);
    expect(entries[2]).toMatchObject({ discovered: true, caughtCount: 7 });
    expect(entries[3]).toMatchObject({ discovered: false, caughtCount: 0 });
    expect(entries[0]).toMatchObject({ discovered: false, caughtCount: 0 });
  });

  it("selling does not remove anything from the encyclopedia", () => {
    let save = saveWithDiscovered(20);
    save = applyCatch(save, "fish_koi", { source: "active", now: 1 }).save;
    const before = getEncyclopediaEntries(save);
    const sold = sellAllPending(save);
    if (!sold.ok) throw new Error("unreachable");
    expect(getEncyclopediaEntries(sold.save)).toEqual(before);
  });
});

describe("rarity filter", () => {
  const save = { discoveredFishIds: FISH_IDS.slice(0, 12), catchCounts: Object.fromEntries(FISH_IDS.slice(0, 12).map((id) => [id, 2])) };
  const counts: Record<FishRarity, number> = { common: 8, uncommon: 7, rare: 5, epic: 3, legendary: 2 };

  it.each(Object.entries(counts))("lists only %s fish (%i of them), in catalogue order", (rarity, count) => {
    const entries = getEncyclopediaEntries(save, rarity as FishRarity);
    expect(entries).toHaveLength(count);
    expect(entries.every((entry) => entry.fish.rarity === rarity)).toBe(true);
    const order = entries.map((entry) => FISH_IDS.indexOf(entry.fish.id));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("'all' and no filter list everything; the options form works too", () => {
    expect(getEncyclopediaEntries(save, "all")).toHaveLength(25);
    expect(getEncyclopediaEntries(save)).toHaveLength(25);
    expect(getEncyclopediaEntries(save, { rarity: "rare" })).toHaveLength(5);
    expect(getEncyclopediaEntries(save, {})).toHaveLength(25);
  });

  it("keeps discovery state and counts under a filter", () => {
    const rare = getEncyclopediaEntries(save, "rare"); // catalogue 15..19, only 15 and 16 discovered
    expect(rare.map((entry) => entry.discovered)).toEqual([false, false, false, false, false]);
    const uncommon = getEncyclopediaEntries(save, "uncommon"); // catalogue 8..14, 8..11 discovered
    expect(uncommon.map((entry) => entry.discovered)).toEqual([true, true, true, true, false, false, false]);
    expect(uncommon[0].caughtCount).toBe(2);
  });
});

describe("getNextUnlock", () => {
  it.each([
    [0, { rarity: "uncommon", needed: 5 }],
    [1, { rarity: "uncommon", needed: 4 }],
    [4, { rarity: "uncommon", needed: 1 }],
    [5, { rarity: "rare", needed: 5 }],
    [9, { rarity: "rare", needed: 1 }],
    [10, { rarity: "epic", needed: 5 }],
    [14, { rarity: "epic", needed: 1 }],
    [15, { rarity: "legendary", needed: 5 }],
    [19, { rarity: "legendary", needed: 1 }],
    [20, null],
    [25, null]
  ])("with %i species discovered -> %j", (count, expected) => {
    expect(getNextUnlock(saveWithDiscovered(count))).toEqual(expected);
  });

  it("agrees with the unlock thresholds in the config and with getUnlockedRarities", () => {
    for (let count = 0; count <= 25; count++) {
      const save = saveWithDiscovered(count);
      const next = getNextUnlock(save);
      const unlocked = getUnlockedRarities(save.discoveredFishIds);
      if (next === null) {
        expect(unlocked).toHaveLength(5);
        continue;
      }
      expect(unlocked).not.toContain(next.rarity);
      expect(next.needed).toBeGreaterThanOrEqual(1);
      expect(count + next.needed).toBe(GAME_CONFIG.collectionUnlocks[next.rarity]);
      expect(getRarityUnlockThreshold(next.rarity)).toBe(count + next.needed);
      // discovering exactly `needed` more species unlocks it
      expect(getUnlockedRarities(FISH_IDS.slice(0, count + next.needed))).toContain(next.rarity);
    }
  });

  it("ignores unknown and duplicate ids like the rest of the encyclopedia", () => {
    expect(getNextUnlock({ discoveredFishIds: [...FISH_IDS.slice(0, 4), FISH_IDS[0], "fish_cultrure", "bogus"] })).toEqual({
      rarity: "uncommon",
      needed: 1
    });
  });
});
