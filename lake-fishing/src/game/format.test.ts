import { describe, expect, it } from "vitest";
import { exportFileName, formatCoins, formatCountdown, formatDuration } from "./format";

describe("format", () => {
  it("formats coins with separators", () => {
    expect(formatCoins(0)).toBe("0");
    expect(formatCoins(1234567)).toBe("1,234,567");
    expect(formatCoins(Number.NaN)).toBe("0");
  });

  it("formats durations in Chinese", () => {
    expect(formatDuration(42)).toBe("42 秒");
    expect(formatDuration(330)).toBe("5 分 30 秒");
    expect(formatDuration(120)).toBe("2 分");
    expect(formatDuration(2 * 3600 + 15 * 60 + 9)).toBe("2 小時 15 分");
    expect(formatDuration(4 * 3600)).toBe("4 小時");
    expect(formatDuration(-5)).toBe("0 秒");
  });

  it("formats the countdown rounding up", () => {
    expect(formatCountdown(90_000)).toBe("1:30");
    expect(formatCountdown(89_001)).toBe("1:30");
    expect(formatCountdown(500)).toBe("0:01");
    expect(formatCountdown(-1)).toBe("0:00");
  });

  it("builds a sortable export file name", () => {
    expect(exportFileName(new Date(2026, 9, 18, 9, 5))).toBe("lake-fishing-save-20261018-0905.json");
  });
});
