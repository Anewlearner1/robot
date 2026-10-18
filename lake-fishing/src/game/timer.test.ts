import { describe, expect, it } from "vitest";
import { MAX_TICK_MS, advanceIdleTimer, timerFraction } from "./timer";

describe("advanceIdleTimer", () => {
  it("accumulates time below the interval without firing", () => {
    const step = advanceIdleTimer(0, 100, 90_000);
    expect(step).toEqual({ progressMs: 100, fired: false });
  });

  it("fires exactly once the interval is reached and carries the remainder", () => {
    let progress = 0;
    let fired = 0;
    // 100 ms ticks for 90 s -> exactly one catch at the end, no drift.
    for (let i = 0; i < 900; i++) {
      const step = advanceIdleTimer(progress, 100, 90_000);
      progress = step.progressMs;
      if (step.fired) fired++;
    }
    expect(fired).toBe(1);
    expect(progress).toBe(0);
  });

  it("produces one catch per interval over a long run (uneven frames)", () => {
    let progress = 0;
    let fired = 0;
    const interval = 54_000; // rod level 6
    let elapsed = 0;
    let i = 0;
    while (elapsed < interval * 5 + 500) {
      const dt = 90 + (i++ % 7) * 5; // 90..120 ms
      elapsed += dt;
      const step = advanceIdleTimer(progress, dt, interval);
      progress = step.progressMs;
      if (step.fired) fired++;
    }
    expect(fired).toBe(5);
  });

  it("ignores the part of a huge gap beyond the cap (sleeping tabs are the offline logic's job)", () => {
    const step = advanceIdleTimer(0, 60 * 60 * 1000, 90_000);
    expect(step.fired).toBe(false);
    expect(step.progressMs).toBe(MAX_TICK_MS);
  });

  it("fires at most once per call even when the interval is tiny", () => {
    const step = advanceIdleTimer(0, 2000, 10, 5000);
    expect(step.fired).toBe(true);
    expect(step.progressMs).toBeLessThan(10);
  });

  it("is safe with NaN / negative input", () => {
    expect(advanceIdleTimer(50, Number.NaN, 1000)).toEqual({ progressMs: 50, fired: false });
    expect(advanceIdleTimer(50, -10, 1000)).toEqual({ progressMs: 50, fired: false });
    expect(advanceIdleTimer(-5, 10, 1000)).toEqual({ progressMs: 10, fired: false });
  });
});

describe("timerFraction", () => {
  it("clamps to 0..1", () => {
    expect(timerFraction(-1, 100)).toBe(0);
    expect(timerFraction(50, 100)).toBe(0.5);
    expect(timerFraction(500, 100)).toBe(1);
  });
});
