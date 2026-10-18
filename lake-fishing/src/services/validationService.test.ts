import { describe, expect, it } from "vitest";
import { EQUIPMENT } from "../data/equipment";
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

describe("bait / rod / minigame config validation", () => {
  const codes = () => validateStaticGameData().map((issue) => issue.code);
  const targets = GAME_CONFIG.bait.targetFishIds as string[];

  /** Run `fn` with a temporary change and always restore. */
  const withChange = (change: () => () => void, fn: () => void) => {
    const restore = change();
    try {
      fn();
    } finally {
      restore();
    }
  };

  it("ships the carp-family target group, all known fish", () => {
    expect(targets).toHaveLength(8);
    const ids = new Set(FISH.map((fish) => fish.id));
    for (const id of targets) expect(ids.has(id), id).toBe(true);
    expect(codes()).toEqual([]);
  });

  it("flags an unknown bait target id", () => {
    withChange(
      () => {
        targets.push("fish_unicorn");
        return () => targets.pop();
      },
      () => expect(codes()).toContain("BAIT_UNKNOWN_TARGET")
    );
  });

  it("flags a legacy (renamed) bait target id", () => {
    withChange(
      () => {
        targets.push("fish_cultrure");
        return () => targets.pop();
      },
      () => expect(codes()).toContain("BAIT_UNKNOWN_TARGET")
    );
  });

  it("flags duplicate and empty target lists", () => {
    withChange(
      () => {
        targets.push(targets[0]);
        return () => targets.pop();
      },
      () => expect(codes()).toContain("BAIT_DUPLICATE_TARGET")
    );
    const saved = targets.splice(0, targets.length);
    try {
      expect(codes()).toContain("BAIT_NO_TARGETS");
    } finally {
      targets.push(...saved);
    }
    expect(codes()).toEqual([]);
  });

  it("flags a bait effect that is not a non-decreasing multiplier starting at 1", () => {
    const bait = EQUIPMENT.find((item) => item.id === "bait")!;
    const original = bait.levels.map((level) => level.effectValue);
    const restore = () => bait.levels.forEach((level, i) => (level.effectValue = original[i]));
    try {
      bait.levels[0].effectValue = 1.1;
      expect(codes()).toContain("BAIT_EFFECT");
      restore();
      bait.levels[3].effectValue = 0.9;
      expect(codes()).toContain("BAIT_EFFECT");
      restore();
      bait.levels[2].effectValue = 1.1; // lower than level 2's 1.2
      expect(codes()).toContain("BAIT_EFFECT");
    } finally {
      restore();
    }
    expect(codes()).toEqual([]);
  });

  it("bait ends at x2.0 and starts at x1.0", () => {
    const bait = EQUIPMENT.find((item) => item.id === "bait")!;
    expect(bait.levels.map((level) => level.effectValue)).toEqual([1, 1.2, 1.4, 1.6, 1.8, 2]);
  });

  it("flags rod display multipliers that disagree with the config", () => {
    const rod = EQUIPMENT.find((item) => item.id === "rod")!;
    const original = rod.levels[2].effectValue;
    try {
      rod.levels[2].effectValue = 0.5;
      expect(codes()).toContain("ROD_EFFECT_MISMATCH");
    } finally {
      rod.levels[2].effectValue = original;
    }
    expect(codes()).toEqual([]);
  });

  it("flags nonsense minigame config", () => {
    const mg = GAME_CONFIG.minigame as { -readonly [K in keyof typeof GAME_CONFIG.minigame]: number };
    for (const [key, bad] of [
      ["bonusCap", 26],
      ["perfectZoneWidth", 0.9],
      ["windowSeconds", 0],
      ["successRatio", 0.9]
    ] as const) {
      const original = mg[key];
      try {
        mg[key] = bad;
        expect(codes(), key).toContain("MINIGAME_CONFIG");
      } finally {
        mg[key] = original;
      }
    }
    expect(codes()).toEqual([]);
  });

  it("keeps the save version in sync", () => {
    expect(GAME_CONFIG.saveVersion).toBe(3);
  });
});
