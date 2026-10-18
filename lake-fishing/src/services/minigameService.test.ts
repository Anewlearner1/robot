import { describe, expect, it } from "vitest";
import { FISH } from "../data/fish";
import { GAME_CONFIG } from "../data/gameConfig";
import type { MinigameConfig } from "../data/gameConfig";
import type { MinigameResult } from "../types/game";
import {
  applyMinigameStreak,
  computeMinigameBonus,
  createTimingRound,
  evaluateTap,
  getRoundProgress,
  getRoundResult,
  getStreakBonus,
  hasTapped,
  indicatorPosition,
  isMinigameWindowOpen,
  isWithinWindow,
  tapRound
} from "./minigameService";
import { createNewSave } from "./saveService";
import { seededRng } from "./testUtils";

/**
 * Binary-friendly config so zone edges are exact in floating point:
 * zone [0.375, 0.625] and perfect zone [0.4375, 0.5625] when rng() = 0.5.
 */
const EXACT: MinigameConfig = {
  ...GAME_CONFIG.minigame,
  windowSeconds: 3,
  indicatorSpeed: 0.5,
  timingZoneWidth: 0.25,
  perfectZoneWidth: 0.125
};
const exactRound = () => createTimingRound(EXACT, () => 0.5);

describe("minigame config (PRD §9)", () => {
  it("has the intended defaults", () => {
    const mg = GAME_CONFIG.minigame;
    expect(mg.windowSeconds).toBe(3);
    expect(mg.successRatio).toBe(0.2);
    expect(mg.perfectRatio).toBe(0.5);
    expect(mg.bonusCap).toBe(25);
    expect(mg.streakBonusPerPerfect).toBe(0);
    expect(mg.streakBonusMax).toBeGreaterThanOrEqual(0);
    expect(mg.indicatorSpeed).toBeGreaterThan(0);
    expect(mg.perfectZoneWidth).toBeLessThan(mg.timingZoneWidth);
  });
});

describe("createTimingRound", () => {
  it("keeps the whole timing zone on the bar for any rng value", () => {
    for (const roll of [0, 0.25, 0.5, 0.75, 0.9999999, 1]) {
      const round = createTimingRound(GAME_CONFIG.minigame, () => roll);
      expect(round.zoneStart).toBeGreaterThanOrEqual(0);
      expect(round.zoneEnd).toBeLessThanOrEqual(1);
      expect(round.zoneEnd - round.zoneStart).toBeCloseTo(GAME_CONFIG.minigame.timingZoneWidth, 12);
      expect(round.perfectEnd - round.perfectStart).toBeCloseTo(GAME_CONFIG.minigame.perfectZoneWidth, 12);
      expect(round.perfectStart).toBeGreaterThanOrEqual(round.zoneStart);
      expect(round.perfectEnd).toBeLessThanOrEqual(round.zoneEnd);
      expect((round.perfectStart + round.perfectEnd) / 2).toBeCloseTo(round.zoneCenter, 12);
    }
  });

  it("randomises the zone from the rng and is reproducible from a seed", () => {
    const a = createTimingRound(GAME_CONFIG.minigame, seededRng(5));
    const b = createTimingRound(GAME_CONFIG.minigame, seededRng(5));
    const c = createTimingRound(GAME_CONFIG.minigame, seededRng(6));
    expect(a).toEqual(b);
    expect(a.zoneCenter).not.toBe(c.zoneCenter);
    const spread = new Set(Array.from({ length: 50 }, (_, i) => createTimingRound(GAME_CONFIG.minigame, seededRng(i)).zoneCenter.toFixed(3)));
    expect(spread.size).toBeGreaterThan(30);
  });

  it("starts with no tap and a window of windowSeconds", () => {
    const round = createTimingRound(GAME_CONFIG.minigame, seededRng(1));
    expect(round.tap).toBeNull();
    expect(hasTapped(round)).toBe(false);
    expect(round.windowMs).toBe(3000);
    expect(getRoundResult(round)).toBe("none");
  });
});

describe("indicatorPosition", () => {
  const round = exactRound();
  it("sweeps 0 -> 1 -> 0 at the configured speed", () => {
    expect(indicatorPosition(round, 0)).toBe(0);
    expect(indicatorPosition(round, 1000)).toBe(0.5);
    expect(indicatorPosition(round, 2000)).toBe(1);
    expect(indicatorPosition(round, 2500)).toBe(0.75);
    expect(indicatorPosition(round, 3000)).toBe(0.5);
    expect(indicatorPosition(round, 4000)).toBe(0);
    expect(indicatorPosition(round, 4500)).toBe(0.25);
  });

  it("stays on the bar and treats negative / junk time as 0", () => {
    for (let t = -500; t < 20_000; t += 137) {
      const p = indicatorPosition(round, t);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
    expect(indicatorPosition(round, -100)).toBe(0);
    expect(indicatorPosition(round, Number.NaN)).toBe(0);
  });
});

describe("evaluateTap boundaries", () => {
  const round = exactRound();
  // zone 0.375..0.625 at 750..1250 ms (going out); perfect 0.4375..0.5625 at 875..1125 ms
  it.each([
    [0, "miss"],
    [749, "miss"],
    [750, "success"], // zone start edge counts
    [874, "success"],
    [875, "perfect"], // perfect start edge counts
    [1000, "perfect"],
    [1125, "perfect"], // perfect end edge counts
    [1126, "success"],
    [1250, "success"], // zone end edge counts
    [1251, "miss"],
    [2000, "miss"]
  ])("outbound pass: tap at %i ms is %s", (elapsed, expected) => {
    expect(evaluateTap(round, elapsed)).toBe(expected);
  });

  it("the return pass counts too (indicator ping-pongs)", () => {
    expect(evaluateTap(round, 2749)).toBe("miss"); // 0.6255
    expect(evaluateTap(round, 2750)).toBe("success"); // 0.625
    expect(evaluateTap(round, 2875)).toBe("perfect"); // 0.5625
    expect(evaluateTap(round, 3000)).toBe("perfect"); // 0.5, last instant of the window
  });

  it("anything outside the window is a miss", () => {
    expect(evaluateTap(round, 3001)).toBe("miss");
    expect(evaluateTap(round, -1)).toBe("miss");
    expect(evaluateTap(round, Number.NaN)).toBe("miss");
    expect(isWithinWindow(round, 0)).toBe(true);
    expect(isWithinWindow(round, 3000)).toBe(true);
    expect(isWithinWindow(round, 3001)).toBe(false);
    expect(isWithinWindow(round, -1)).toBe(false);
  });

  it("is never a worse result for a tap nearer the centre (perfect <= success <= miss distance)", () => {
    const rank = { perfect: 0, success: 1, miss: 2 } as const;
    const r = createTimingRound(GAME_CONFIG.minigame, seededRng(3));
    for (let t = 0; t <= 3000; t += 7) {
      const d = Math.abs(indicatorPosition(r, t) - r.zoneCenter);
      const result = evaluateTap(r, t);
      if (d <= GAME_CONFIG.minigame.perfectZoneWidth / 2 - 1e-9) expect(rank[result]).toBe(0);
      else if (d <= GAME_CONFIG.minigame.timingZoneWidth / 2 - 1e-9) expect(rank[result]).toBe(1);
      else if (d > GAME_CONFIG.minigame.timingZoneWidth / 2 + 1e-9) expect(rank[result]).toBe(2);
    }
  });

  it("a perfect and a success are reachable in every default round (zone anywhere on the bar)", () => {
    for (let i = 0; i <= 100; i++) {
      const r = createTimingRound(GAME_CONFIG.minigame, () => i / 100);
      const results = new Set<string>();
      for (let t = 0; t <= 3000; t += 5) results.add(evaluateTap(r, t));
      expect(results.has("perfect"), `roll ${i / 100}`).toBe(true);
      expect(results.has("success")).toBe(true);
    }
  });
});

describe("only the first tap counts", () => {
  it("tapRound stores the first tap and ignores every later one", () => {
    const round = exactRound();
    const first = tapRound(round, 1000);
    expect(first).toMatchObject({ result: "perfect", counted: true });
    expect(hasTapped(first.round)).toBe(true);
    expect(first.round.tap).toEqual({ elapsedMs: 1000, result: "perfect" });

    const second = tapRound(first.round, 100); // would have been a miss
    expect(second.counted).toBe(false);
    expect(second.result).toBe("perfect");
    expect(second.round).toBe(first.round);
    expect(getRoundResult(second.round)).toBe("perfect");
  });

  it("a first tap that misses cannot be corrected by a second one", () => {
    const miss = tapRound(exactRound(), 100);
    expect(miss).toMatchObject({ result: "miss", counted: true });
    const retry = tapRound(miss.round, 1000);
    expect(retry).toMatchObject({ result: "miss", counted: false });
    expect(evaluateTap(miss.round, 1000)).toBe("miss"); // evaluateTap also honours the stored tap
  });

  it("does not mutate the round it was given", () => {
    const round = exactRound();
    tapRound(round, 1000);
    expect(round.tap).toBeNull();
  });
});

describe("window helpers", () => {
  it("opens for the last windowSeconds of the countdown", () => {
    expect(isMinigameWindowOpen(3001)).toBe(false);
    expect(isMinigameWindowOpen(3000)).toBe(true);
    expect(isMinigameWindowOpen(1)).toBe(true);
    expect(isMinigameWindowOpen(0)).toBe(false);
    expect(isMinigameWindowOpen(-5)).toBe(false);
  });

  it("reports progress through the window", () => {
    const round = exactRound();
    expect(getRoundProgress(round, 0)).toBe(0);
    expect(getRoundProgress(round, 1500)).toBe(0.5);
    expect(getRoundProgress(round, 9000)).toBe(1);
    expect(getRoundProgress(round, -5)).toBe(0);
  });
});

describe("computeMinigameBonus", () => {
  // Independent expectation in integer arithmetic: ceil(price * 0.5) = ceil(price / 2), ceil(price * 0.2) = ceil(price / 5).
  const expected = (price: number, result: MinigameResult) =>
    result === "perfect" ? Math.min(25, Math.ceil(price / 2)) : result === "success" ? Math.min(25, Math.ceil(price / 5)) : 0;

  it("is min(cap, ceil(sellPrice x ratio)) for every fish and every result", () => {
    for (const fish of FISH) {
      for (const result of ["perfect", "success", "miss", "none"] as const) {
        const bonus = computeMinigameBonus(fish, result);
        expect(bonus, `${fish.id} ${result}`).toBe(expected(fish.sellPrice, result));
        expect(bonus).toBeLessThanOrEqual(25);
        expect(bonus).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(bonus)).toBe(true);
      }
    }
  });

  it("known values", () => {
    const price = (id: string) => FISH.find((f) => f.id === id)!;
    expect(computeMinigameBonus(price("fish_carp"), "perfect")).toBe(4); // 8 * 0.5
    expect(computeMinigameBonus(price("fish_carp"), "success")).toBe(2); // ceil(1.6)
    expect(computeMinigameBonus(price("fish_catfish"), "success")).toBe(3); // ceil(2.4)
    expect(computeMinigameBonus(price("fish_koi"), "perfect")).toBe(25); // 25 exactly = cap
    expect(computeMinigameBonus(price("fish_koi"), "success")).toBe(10);
    expect(computeMinigameBonus(price("fish_lake_guardian"), "perfect")).toBe(25); // 250 -> capped
    expect(computeMinigameBonus(price("fish_lake_guardian"), "success")).toBe(25); // 100 -> capped
    expect(computeMinigameBonus(price("fish_crucian_carp"), "success")).toBe(1); // 5 * 0.2 = 1, not 2
  });

  it("a miss or no tap gives nothing", () => {
    for (const fish of FISH) {
      expect(computeMinigameBonus(fish, "miss")).toBe(0);
      expect(computeMinigameBonus(fish, "none")).toBe(0);
    }
  });

  it("respects a lowered cap and degenerate config", () => {
    const koi = FISH.find((f) => f.id === "fish_koi")!;
    expect(computeMinigameBonus(koi, "perfect", { ...GAME_CONFIG.minigame, bonusCap: 10 })).toBe(10);
    expect(computeMinigameBonus(koi, "perfect", { ...GAME_CONFIG.minigame, bonusCap: 0 })).toBe(0);
    expect(computeMinigameBonus(koi, "perfect", { ...GAME_CONFIG.minigame, perfectRatio: -1 })).toBe(0);
    expect(computeMinigameBonus(koi, "perfect", { ...GAME_CONFIG.minigame, perfectRatio: Number.NaN })).toBe(0);
    expect(computeMinigameBonus({ sellPrice: -5 }, "perfect")).toBe(0);
  });

  it("never exceeds the cap even with absurd ratios", () => {
    const absurd = { ...GAME_CONFIG.minigame, perfectRatio: 100, successRatio: 100 };
    for (const fish of FISH) {
      expect(computeMinigameBonus(fish, "perfect", absurd)).toBeLessThanOrEqual(25);
      expect(computeMinigameBonus(fish, "success", absurd)).toBeLessThanOrEqual(25);
    }
  });
});

describe("perfect streak", () => {
  it("perfect adds one; success, miss and none reset", () => {
    let save = createNewSave(1);
    save = applyMinigameStreak(save, "perfect");
    save = applyMinigameStreak(save, "perfect");
    expect(save.minigame.perfectStreak).toBe(2);
    for (const result of ["success", "miss", "none"] as const) {
      expect(applyMinigameStreak(save, result).minigame.perfectStreak, result).toBe(0);
    }
    expect(applyMinigameStreak(save, "perfect").minigame.perfectStreak).toBe(3);
  });

  it("is pure, and returns the same save when nothing changes", () => {
    const save = createNewSave(1);
    expect(applyMinigameStreak(save, "miss")).toBe(save);
    const next = applyMinigameStreak(save, "perfect");
    expect(save.minigame.perfectStreak).toBe(0);
    expect(next).not.toBe(save);
  });

  it("converts to a capped bonus", () => {
    const cfg = { streakBonusPerPerfect: 0.05, streakBonusMax: 0.2 };
    expect(getStreakBonus(0, cfg)).toBe(0);
    expect(getStreakBonus(2, cfg)).toBeCloseTo(0.1, 12);
    expect(getStreakBonus(4, cfg)).toBeCloseTo(0.2, 12);
    expect(getStreakBonus(400, cfg)).toBe(0.2);
    expect(getStreakBonus(-3, cfg)).toBe(0);
    expect(getStreakBonus(Number.NaN, cfg)).toBe(0);
    expect(getStreakBonus(1_000)).toBe(0); // shipped config: off
  });
});
