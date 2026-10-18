import { describe, expect, it } from "vitest";
import { GAME_CONFIG } from "../data/gameConfig";
import {
  createMinigameState,
  getMinigameTimeFraction,
  isMinigamePromptExpired,
  isPerfectResult,
  stepMinigame,
  type MinigameState
} from "./minigameService";
import { seededRng } from "./testUtils";

const FRAME = 50;

/** Play a round with a policy until it ends (or 30 s pass). */
function play(seed: number, policy: (state: MinigameState, t: number) => boolean): MinigameState {
  let state = createMinigameState(GAME_CONFIG.minigame, seededRng(seed));
  for (let t = 0; state.status === "playing" && t < 30_000; t += FRAME) {
    state = stepMinigame(state, FRAME, policy(state, t));
  }
  return state;
}

/** Follows the green zone's centre. */
const follow = (s: MinigameState) => s.indicator < s.zoneCenter;

/** Follows it, but only reacts 300 ms late and makes a random wrong choice 25% of the time. */
function casualPolicy(seed: number) {
  const rng = seededRng(seed * 31 + 7);
  let held = false;
  let nextDecision = 0;
  return (s: MinigameState, t: number) => {
    if (t >= nextDecision) {
      nextDecision = t + 250 + rng() * 300;
      held = rng() < 0.25 ? rng() < 0.5 : follow(s);
    }
    return held;
  };
}

describe("minigame config", () => {
  it("is within the intended 8-12 s / 15 s envelope", () => {
    expect(GAME_CONFIG.minigame.timeLimitMs).toBeGreaterThanOrEqual(8000);
    expect(GAME_CONFIG.minigame.timeLimitMs).toBeLessThanOrEqual(12_000);
    expect(GAME_CONFIG.minigame.promptTimeoutMs).toBe(15_000);
  });
});

describe("createMinigameState", () => {
  it("starts playing, in the zone, with the configured progress", () => {
    const s = createMinigameState(GAME_CONFIG.minigame, seededRng(1));
    expect(s.status).toBe("playing");
    expect(s.elapsedMs).toBe(0);
    expect(s.progress).toBe(GAME_CONFIG.minigame.startProgress);
    expect(s.inZone).toBe(true);
    expect(s.indicator).toBe(s.zoneCenter);
    expect(s.zoneCenter - s.zoneHalfWidth).toBeGreaterThanOrEqual(0);
    expect(s.zoneCenter + s.zoneHalfWidth).toBeLessThanOrEqual(1);
  });

  it("is reproducible from a seed and varies between seeds", () => {
    const a = createMinigameState(GAME_CONFIG.minigame, seededRng(5));
    const b = createMinigameState(GAME_CONFIG.minigame, seededRng(5));
    const c = createMinigameState(GAME_CONFIG.minigame, seededRng(6));
    expect(a).toEqual(b);
    expect(a.zonePhase).not.toBe(c.zonePhase);
  });
});

describe("stepMinigame", () => {
  it("holding raises the indicator, releasing lowers it, both clamp to 0..1", () => {
    let s = createMinigameState(GAME_CONFIG.minigame, seededRng(1));
    const start = s.indicator;
    s = stepMinigame(s, 100, true);
    expect(s.indicator).toBeCloseTo(start + GAME_CONFIG.minigame.reelPerSecond * 0.1, 6);
    s = stepMinigame(s, 5000, true);
    expect(s.indicator).toBe(1);
    s = stepMinigame(createMinigameState(GAME_CONFIG.minigame, seededRng(1)), 3000, false);
    expect(s.indicator).toBe(0);
  });

  it("fills while in the zone and drains outside it", () => {
    let s = createMinigameState(GAME_CONFIG.minigame, seededRng(1));
    const p0 = s.progress;
    s = stepMinigame(s, 100, s.indicator < s.zoneCenter);
    expect(s.inZone).toBe(true);
    expect(s.progress).toBeGreaterThan(p0);
    const out = stepMinigame(createMinigameState(GAME_CONFIG.minigame, seededRng(1)), 2000, true);
    expect(out.inZone).toBe(false);
    const before = out.progress;
    expect(stepMinigame(out, 500, true).progress).toBeLessThan(before);
  });

  it("is deterministic and independent of how frames are sliced", () => {
    const start = createMinigameState(GAME_CONFIG.minigame, seededRng(9));
    const big = stepMinigame(start, 1000, true);
    let small = start;
    for (let i = 0; i < 20; i++) small = stepMinigame(small, 50, true);
    expect(big.indicator).toBeCloseTo(small.indicator, 9);
    expect(big.progress).toBeCloseTo(small.progress, 9);
    expect(big.elapsedMs).toBe(1000);
  });

  it("does not mutate the previous state and ignores non-positive dt", () => {
    const start = createMinigameState(GAME_CONFIG.minigame, seededRng(2));
    const snapshot = JSON.stringify(start);
    stepMinigame(start, 100, true);
    expect(JSON.stringify(start)).toBe(snapshot);
    expect(stepMinigame(start, 0, true)).toBe(start);
    expect(stepMinigame(start, -50, true)).toBe(start);
    expect(stepMinigame(start, Number.NaN, true)).toBe(start);
  });

  it("freezes a finished round", () => {
    const done = play(1, follow);
    expect(done.status).toBe("success");
    expect(stepMinigame(done, 1000, true)).toBe(done);
  });

  it("times out as a fail at the time limit", () => {
    const s = stepMinigame(createMinigameState(GAME_CONFIG.minigame, seededRng(3)), 60_000, false);
    expect(s.status).toBe("fail");
    expect(s.elapsedMs).toBeGreaterThanOrEqual(GAME_CONFIG.minigame.timeLimitMs);
    expect(s.elapsedMs).toBeLessThan(GAME_CONFIG.minigame.timeLimitMs + FRAME);
    expect(getMinigameTimeFraction(s)).toBe(1);
  });

  it("success needs a handful of seconds, not an instant win", () => {
    const done = play(4, follow);
    expect(done.status).toBe("success");
    expect(done.elapsedMs).toBeGreaterThan(4000);
    expect(done.elapsedMs).toBeLessThan(GAME_CONFIG.minigame.timeLimitMs);
  });
});

describe("minigame outcomes", () => {
  it("a player who follows the zone always wins", () => {
    for (let seed = 1; seed <= 100; seed++) expect(play(seed, follow).status).toBe("success");
  });

  it("a player who never holds always loses", () => {
    for (let seed = 1; seed <= 100; seed++) expect(play(seed, () => false).status).toBe("fail");
  });

  it("a player who holds forever always loses", () => {
    for (let seed = 1; seed <= 100; seed++) expect(play(seed, () => true).status).toBe("fail");
  });

  it("a delayed, error-prone casual player wins most rounds", () => {
    let wins = 0;
    const n = 200;
    for (let seed = 1; seed <= n; seed++) {
      if (play(seed, casualPolicy(seed)).status === "success") wins++;
    }
    expect(wins / n).toBeGreaterThan(0.8);
  });

  it("perfect only for a win", () => {
    expect(isPerfectResult(play(1, follow))).toBe(true);
    expect(isPerfectResult(play(1, () => false))).toBe(false);
    expect(isPerfectResult(createMinigameState(GAME_CONFIG.minigame, seededRng(1)))).toBe(false);
  });
});

describe("bite prompt timeout", () => {
  it("expires after 15 seconds", () => {
    expect(isMinigamePromptExpired(1000, 1000 + 14_999)).toBe(false);
    expect(isMinigamePromptExpired(1000, 1000 + 15_000)).toBe(true);
    expect(isMinigamePromptExpired(1000, 500)).toBe(false); // clock went backwards
  });
});
