import type { FishRarity, MinigameResult, TapResult } from "../services";
import { RARITY_ORDER } from "../services";

export { RARITY_ORDER };

export const RARITY_LABEL: Record<FishRarity, string> = {
  common: "普通",
  uncommon: "少見",
  rare: "稀有",
  epic: "史詩",
  legendary: "傳說"
};

/** Instant feedback shown when the player taps in the bobber-timing window. */
export const TAP_LABEL: Record<TapResult, string> = {
  perfect: "完美！",
  success: "不錯！",
  miss: "差一點"
};

/** Short tag for the catch log; "none" (no tap) has no tag. */
export const RESULT_TAG: Record<MinigameResult, string | null> = {
  perfect: "完美",
  success: "不錯",
  miss: "差一點",
  none: null
};

/** 1234567 -> "1,234,567" (always ASCII separators so the width is stable). */
export function formatCoins(value: number): string {
  const n = Number.isFinite(value) ? Math.round(value) : 0;
  return n.toLocaleString("en-US");
}

/** Whole seconds -> "2 小時 15 分" / "5 分 30 秒" / "42 秒". */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(totalSeconds) ? totalSeconds : 0));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  if (hours > 0) return minutes > 0 ? `${hours} 小時 ${minutes} 分` : `${hours} 小時`;
  if (minutes > 0) return seconds > 0 ? `${minutes} 分 ${seconds} 秒` : `${minutes} 分`;
  return `${seconds} 秒`;
}

/** Milliseconds left -> "m:ss" (rounded up, never negative). */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil((Number.isFinite(ms) ? ms : 0) / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** File name for the exported save, e.g. lake-fishing-save-20261018-0930.json */
export function exportFileName(date: Date): string {
  const p = (n: number) => n.toString().padStart(2, "0");
  return `lake-fishing-save-${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}.json`;
}
