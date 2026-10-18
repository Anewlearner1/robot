import type { FishRarity } from "../types/game";

/** Rarity accent colors (common greyish-white, uncommon green, rare blue, epic purple, legendary gold). */
export const RARITY_COLORS: Record<FishRarity, string> = {
  common: "#d9dee2",
  uncommon: "#6fcf74",
  rare: "#4da6ff",
  epic: "#b66cff",
  legendary: "#ffc93a"
};

export interface RGB {
  r: number;
  g: number;
  b: number;
}

/** Parse `#rgb` / `#rrggbb` into channels. */
export function hexToRgb(hex: string): RGB {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h.slice(0, 6), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

const clamp255 = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

export function rgbToHex({ r, g, b }: RGB): string {
  return "#" + [r, g, b].map((v) => clamp255(v).toString(16).padStart(2, "0")).join("");
}

/** Linear mix of two hex colors: t=0 -> a, t=1 -> b. */
export function mix(a: string, b: string, t: number): string {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  return rgbToHex({
    r: ca.r + (cb.r - ca.r) * t,
    g: ca.g + (cb.g - ca.g) * t,
    b: ca.b + (cb.b - ca.b) * t
  });
}

export const lighten = (hex: string, t: number) => mix(hex, "#ffffff", t);
export const darken = (hex: string, t: number) => mix(hex, "#0f1424", t);

/** `rgba()` string from a hex color and alpha (0..1). */
export function withAlpha(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}
