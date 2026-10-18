import { describe, expect, it } from "vitest";
import { FISH, LEGACY_FISH_ID_MAP } from "../data/fish";
import { GAME_CONFIG } from "../data/gameConfig";
import { validateStaticGameData } from "./validationService";

describe("static game data", () => {
  it("contains exactly 25 fish with unique IDs", () => {
    expect(FISH).toHaveLength(25);
    expect(new Set(FISH.map((fish) => fish.id)).size).toBe(25);
  });

  it("has rarity weights totaling 100", () => {
    const total = Object.values(GAME_CONFIG.rarityWeights).reduce((sum, value) => sum + value, 0);
    expect(total).toBeCloseTo(100);
  });

  it("passes static data validation", () => {
    expect(validateStaticGameData()).toEqual([]);
  });

  it("uses the renamed xenocypris id and image key, with no cultrure leftovers", () => {
    const fish = FISH.find((f) => f.id === "fish_xenocypris");
    expect(fish?.imageKey).toBe("fish-xenocypris");
    expect(FISH.some((f) => f.id === "fish_cultrure" || f.imageKey === "fish-cultrure")).toBe(false);
    expect(LEGACY_FISH_ID_MAP).toEqual({ fish_cultrure: "fish_xenocypris" });
  });

  it("gives every fish an image key derived from its id, all unique", () => {
    for (const fish of FISH) expect(fish.imageKey).toBe(fish.id.replace(/^fish_/, "fish-").replace(/_/g, "-"));
    expect(new Set(FISH.map((f) => f.imageKey)).size).toBe(25);
  });

  it("flags a legacy id that is still in the catalogue", () => {
    FISH[0].id = "fish_cultrure";
    try {
      expect(validateStaticGameData().map((i) => i.code)).toContain("LEGACY_ID_STILL_PRESENT");
    } finally {
      FISH[0].id = "fish_crucian_carp";
    }
  });
});
