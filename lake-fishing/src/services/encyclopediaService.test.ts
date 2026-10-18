import { describe, expect, it } from "vitest";
import { getCollectionProgress, getEncyclopediaEntries, getKnownDiscoveredIds } from "./encyclopediaService";
import { getUnlockedRarities } from "./fishingService";
import { FISH_IDS } from "./testUtils";

describe("encyclopedia", () => {
  it("counts only known, distinct ids (shared with unlock gating)", () => {
    const dirty = [...FISH_IDS.slice(0, 4), FISH_IDS[0], "fish_cultrure", "bogus"];
    expect(getKnownDiscoveredIds(dirty)).toEqual(FISH_IDS.slice(0, 4));
    expect(getCollectionProgress(dirty).discoveredCount).toBe(4);
    // Raw length is 7, but unlocking must agree with the encyclopedia: still only 4.
    expect(getUnlockedRarities(dirty)).toEqual(["common"]);
  });

  it("reports progress", () => {
    expect(getCollectionProgress([])).toEqual({ discoveredCount: 0, totalCount: 25, percentage: 0 });
    expect(getCollectionProgress(FISH_IDS.slice(0, 10))).toEqual({ discoveredCount: 10, totalCount: 25, percentage: 40 });
    expect(getCollectionProgress(FISH_IDS).percentage).toBe(100);
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
});
