import type { FishRarity } from "../types/game";
import { RARITY_COLORS, darken, lighten, mix, withAlpha } from "./palette";
import { type ParsedSprite, type Palette, type SpriteMap, getCachedCanvas, getCachedDataUrl, gridToMap, parseSprite } from "./sprite";
import { type BodySpec, type FinSpec, addHalo, addOutline, addSparkle, buildBody, hash2, setPx } from "./fishBody";

export const FISH_SPRITE_WIDTH = 32;
export const FISH_SPRITE_HEIGHT = 16;
const W = FISH_SPRITE_WIDTH;
const H = FISH_SPRITE_HEIGHT;

export interface FishSpriteOptions {
  /** Render as a single dark flat silhouette (undiscovered encyclopedia entry). */
  silhouette?: boolean;
  /** Silhouette color override. */
  silhouetteColor?: string;
}

interface Colors {
  b: string;
  d?: string;
  l?: string;
  f?: string;
  F?: string;
  o?: string;
  s?: string;
  w?: string;
  m1?: string;
  m2?: string;
  m3?: string;
}

interface Species {
  rarity: FishRarity;
  body: Omit<BodySpec, "W" | "H">;
  colors: Colors;
}

type Ellipse = { t: number; r: number; a: number; b: number };
const inEllipse = (e: Ellipse, t: number, r: number) => ((t - e.t) / e.a) ** 2 + ((r - e.r) / e.b) ** 2 < 1;

// ---------- body shape templates ----------
const top = (a: number, b: number, h: number, spiky = false): FinSpec => ({ a, b, h, spiky });

const SLIM = (o: Partial<BodySpec> = {}): Omit<BodySpec, "W" | "H"> => ({
  x0: 7, x1: 27, hmax: 3, tp: 0.45, p: 2.4, tailMin: 1, headMin: 1, topF: 1, botF: 0.95,
  tail: { len: 6, h: 3.4, fork: 3 },
  topFins: [top(0.36, 0.62, 2)],
  botFins: [top(0.58, 0.78, 1.4)],
  eye: { dx: 4, row: 1 }, gill: 7,
  ...o
});

const CARP = (o: Partial<BodySpec> = {}): Omit<BodySpec, "W" | "H"> => ({
  x0: 7, x1: 27, hmax: 4.9, tp: 0.42, p: 2.3, tailMin: 1.5, headMin: 1.6, topF: 1.1, botF: 0.95,
  tail: { len: 6, h: 4.2, fork: 2 },
  topFins: [top(0.22, 0.72, 2)],
  botFins: [top(0.62, 0.8, 1.6)],
  eye: { dx: 4, row: 2 }, gill: 7,
  extras: (g, i) => {
    // short barbels
    setPx(g, i.x1 + 1, Math.round(i.cy) + 1, "w");
    setPx(g, i.x1 + 1, Math.round(i.cy) + 2, "w");
  },
  ...o
});

const TROUT = (o: Partial<BodySpec> = {}): Omit<BodySpec, "W" | "H"> => ({
  x0: 5, x1: 28, hmax: 3.8, tp: 0.46, p: 2.6, tailMin: 1.2, headMin: 1.4, topF: 1, botF: 0.95,
  tail: { len: 5, h: 4.2, fork: 2 },
  topFins: [top(0.4, 0.58, 2), top(0.16, 0.22, 1)],
  botFins: [top(0.2, 0.34, 1.4)],
  eye: { dx: 4, row: 1 }, gill: 7,
  ...o
});

// ---------- mark helpers ----------
const scaleLattice = (period = 3, ch = "1") => (m: { x: number; y: number; ch: string; r: number }) =>
  (m.x + m.y * 2) % period === 0 && m.r > 0.12 && m.r < 0.9 && m.ch !== "l" ? ch : undefined;

const SPECIES: Record<string, Species> = {
  // ---------------- common ----------------
  fish_crucian_carp: {
    rarity: "common",
    body: CARP({ x0: 9, x1: 26, hmax: 4.1, tp: 0.45, tail: { len: 5, h: 3.4, fork: 1 }, marks: scaleLattice(4) , extras: undefined }),
    colors: { b: "#a79a62", d: "#7d7448", l: "#d8cf9a", f: "#8f8450", m1: "#938854" }
  },
  fish_river_sprat: {
    rarity: "common",
    body: SLIM({ x0: 9, x1: 27, hmax: 2.5, tail: { len: 5, h: 3, fork: 2 }, marks: (m) => (m.r > 0.42 && m.r < 0.6 && m.t > 0.1 ? "1" : undefined) }),
    colors: { b: "#9ec3cf", d: "#5f8e8f", l: "#e4f0f0", f: "#c9a46a", m1: "#6aa8d8" }
  },
  fish_carp: {
    rarity: "common",
    body: CARP({ marks: scaleLattice(3) }),
    colors: { b: "#b48b52", d: "#835f36", l: "#e2c47f", f: "#a37a47", m1: "#a07b46", w: "#e2c47f" }
  },
  fish_loach: {
    rarity: "common",
    body: {
      x0: 5, x1: 27, hmax: 2.1, tp: 0.55, p: 3, tailMin: 1.1, headMin: 1.1, topF: 1, botF: 1,
      wave: { amp: 1.1, freq: 1.0, phase: 0.2 },
      tail: { len: 3, h: 2, fork: 0 },
      topFins: [top(0.45, 0.62, 1.4)], botFins: [top(0.6, 0.72, 1)],
      eye: { dx: 3, row: 1 }, pect: { dx: 7, dy: 0 }, gill: 6,
      marks: (m) => (hash2(m.x, m.y, 3) < 0.2 && m.r < 0.8 ? "1" : undefined),
      extras: (g, i) => {
        const y = Math.round(i.center(i.x1)) ;
        setPx(g, i.x1 + 1, y + 1, "w"); setPx(g, i.x1 + 1, y + 2, "w"); setPx(g, i.x1, y + 2, "w");
        setPx(g, i.x1 + 1, y - 1, "w");
      }
    },
    colors: { b: "#a58b61", d: "#7a6542", l: "#e0cf9a", f: "#8c7550", m1: "#4f4130", w: "#d6c28a" }
  },
  fish_gibel: {
    rarity: "common",
    body: CARP({ x0: 7, x1: 27, hmax: 4.4, tp: 0.45, extras: undefined, tail: { len: 6, h: 3.8, fork: 2 }, marks: scaleLattice(4) }),
    colors: { b: "#9fa89a", d: "#6d7a6a", l: "#d9ddc9", f: "#8a9582", m1: "#8d9788" }
  },
  fish_bitterling: {
    rarity: "common",
    body: SLIM({ x0: 10, x1: 26, hmax: 3.6, tp: 0.48, p: 2.1, tail: { len: 5, h: 3.2, fork: 2 }, marks: (m) => (m.r > 0.5 && m.r < 0.72 && m.t > 0.05 && m.t < 0.8 ? "1" : m.r > 0.2 && m.r <= 0.5 && m.t > 0.55 && m.t < 0.8 && hash2(m.x, m.y) < 0.3 ? "2" : undefined) }),
    colors: { b: "#c7d3d6", d: "#8ea5b4", l: "#f2f5f2", f: "#e07a5f", m1: "#3fb8b0", m2: "#e8a0b8" }
  },
  fish_silver_bream: {
    rarity: "common",
    body: SLIM({ x0: 5, x1: 28, hmax: 3.1, tail: { len: 5, h: 3.6, fork: 3 }, marks: (m) => (hash2(m.x, m.y, 7) < 0.1 && m.ch !== "l" ? "s" : undefined) }),
    colors: { b: "#d4dde2", d: "#9fb0bc", l: "#f6fafa", f: "#bccad2", s: "#ffffff" }
  },
  fish_tank_goby: {
    rarity: "common",
    body: {
      x0: 6, x1: 26, hmax: 3.7, tp: 0.62, p: 2.2, tailMin: 1.2, headMin: 2.2, topF: 1, botF: 0.75,
      tail: { len: 4, h: 3, fork: 0 },
      topFins: [top(0.22, 0.4, 2.4), top(0.46, 0.66, 2)],
      botFins: [top(0.35, 0.6, 1)],
      eye: { dx: 3, row: 1 }, gill: 6,
      marks: (m) => (hash2(Math.floor(m.x / 2), Math.floor(m.y / 2), 11) < 0.3 ? "1" : hash2(m.x, m.y, 5) < 0.12 ? "2" : undefined)
    },
    colors: { b: "#8f7a5a", d: "#5e4e3a", l: "#c9b48a", f: "#7c6a4c", m1: "#6f5c42", m2: "#c9a45c" }
  },

  // ---------------- uncommon ----------------
  fish_catfish: {
    rarity: "uncommon",
    body: {
      x0: 4, x1: 25, hmax: 4.3, tp: 0.78, p: 1.7, tailMin: 1.3, headMin: 2.4, topF: 0.9, botF: 0.9,
      tail: { len: 4, h: 3, fork: 0 },
      topFins: [top(0.45, 0.58, 3)],
      botFins: [top(0.2, 0.78, 1.8)],
      eye: { dx: 5, row: 1 }, gill: 8,
      marks: (m) => (hash2(m.x, m.y, 9) < 0.14 && m.r < 0.85 ? "1" : undefined),
      extras: (g, i) => {
        const y = Math.round(i.cy);
        // barbels
        setPx(g, 26, y, "w"); setPx(g, 27, y + 1, "w"); setPx(g, 28, y + 2, "w"); setPx(g, 29, y + 3, "w");
        setPx(g, 26, y + 2, "w"); setPx(g, 27, y + 3, "w"); setPx(g, 28, y + 4, "w");
        setPx(g, 25, y - 3, "w"); setPx(g, 26, y - 4, "w"); setPx(g, 27, y - 4, "w");
      }
    },
    colors: { b: "#6b7280", d: "#454c5c", l: "#b9b7a8", f: "#575e6e", m1: "#3b4252", w: "#d9d6c4" }
  },
  fish_mandarin_fish: {
    rarity: "uncommon",
    body: {
      x0: 6, x1: 27, hmax: 4.9, tp: 0.5, p: 2.2, tailMin: 1.4, headMin: 1.9, topF: 1.1, botF: 0.9,
      tail: { len: 5, h: 3.8, fork: 0 },
      topFins: [top(0.2, 0.6, 3, true), top(0.64, 0.84, 2)],
      botFins: [top(0.62, 0.8, 1.6), top(0.28, 0.4, 1.2)],
      eye: { dx: 4, row: 2 }, gill: 7,
      marks: (m) => {
        const band = [[0.22, 0.32], [0.4, 0.5], [0.58, 0.67]].some(([a, b]) => m.t >= a - m.r * 0.05 && m.t <= b - m.r * 0.05);
        if (band && m.ch !== "l") return "1";
        return hash2(m.x, m.y, 2) < 0.1 ? "2" : undefined;
      }
    },
    colors: { b: "#b9a24a", d: "#7f6e2c", l: "#ecdc9a", f: "#a58d3c", m1: "#4b4224", m2: "#e4cf6a" }
  },
  fish_largemouth_bass: {
    rarity: "uncommon",
    body: TROUT({
      x0: 4, x1: 28, hmax: 4.1, headMin: 2.2, tp: 0.55,
      topFins: [top(0.24, 0.5, 2.2, true), top(0.56, 0.76, 1.6)],
      marks: (m) => (m.r > 0.34 && m.r < 0.6 && m.t > 0.12 && m.t < 0.9 && (m.x + m.y) % 4 !== 0 ? "1" : undefined),
      extras: (g, i) => {
        const y = Math.round(i.cy) + 1;
        for (let x = i.x1 - 5; x <= i.x1; x++) setPx(g, x, y, "g");
      }
    }),
    colors: { b: "#7fa05a", d: "#547338", l: "#d6e0a6", f: "#6c8c4a", m1: "#3a5230" }
  },
  fish_bream: {
    rarity: "uncommon",
    body: {
      x0: 7, x1: 26, hmax: 6, tp: 0.46, p: 1.9, tailMin: 1.2, headMin: 1.3, topF: 1.05, botF: 1,
      tail: { len: 6, h: 4.2, fork: 3 },
      topFins: [top(0.36, 0.56, 2.4)],
      botFins: [top(0.4, 0.88, 2)],
      eye: { dx: 4, row: 2 }, gill: 6,
      marks: scaleLattice(3)
    },
    colors: { b: "#b8aa86", d: "#8a7d5c", l: "#e8e0c2", f: "#8e8064", m1: "#a89a76" }
  },
  fish_xenocypris: {
    rarity: "uncommon",
    body: SLIM({ x0: 6, x1: 27, hmax: 3.4, tail: { len: 6, h: 3.8, fork: 3 }, marks: (m) => (m.r > 0.46 && m.r < 0.62 && m.t > 0.15 ? "1" : undefined) }),
    colors: { b: "#c9c58a", d: "#8f9462", l: "#f1efc6", f: "#e08c4c", m1: "#e6dc8a" }
  },
  fish_koi_gibel: {
    rarity: "uncommon",
    body: CARP({ x0: 7, x1: 27, hmax: 4.5, extras: undefined, tail: { len: 6, h: 4, fork: 2 },
      marks: (m) => {
        const o: Ellipse[] = [{ t: 0.3, r: 0.3, a: 0.16, b: 0.5 }, { t: 0.72, r: 0.45, a: 0.14, b: 0.5 }];
        const p: Ellipse[] = [{ t: 0.55, r: 0.2, a: 0.1, b: 0.4 }, { t: 0.2, r: 0.7, a: 0.1, b: 0.4 }];
        if (o.some((e) => inEllipse(e, m.t, m.r))) return "1";
        if (p.some((e) => inEllipse(e, m.t, m.r))) return "2";
        return undefined;
      } }),
    colors: { b: "#e9d9c4", d: "#d0b99a", l: "#fbf3e6", f: "#f0a98a", m1: "#f08a4b", m2: "#f2a6b6" }
  },
  fish_silver_gibel: {
    rarity: "uncommon",
    body: CARP({ x0: 7, x1: 27, hmax: 4.5, extras: undefined, tail: { len: 6, h: 3.8, fork: 2 },
      marks: (m) => (hash2(m.x, m.y, 4) < 0.14 && m.ch !== "l" ? "s" : (m.x + m.y * 2) % 4 === 0 && m.ch !== "l" ? "1" : undefined) }),
    colors: { b: "#c4ccd2", d: "#8d9aa8", l: "#f2f6f8", f: "#a9b4be", m1: "#b2bcc6", s: "#ffffff" }
  },

  // ---------------- rare ----------------
  fish_golden_carp: {
    rarity: "rare",
    body: CARP({ marks: (m) => (m.r < 0.22 && m.ch === "d" && m.t > 0.2 && m.t < 0.8 && m.x % 2 === 0 ? "s" : (m.x + m.y * 2) % 3 === 0 && m.ch !== "l" ? "1" : undefined) }),
    colors: { b: "#f0b92e", d: "#c98a1a", l: "#ffe28a", f: "#e8a424", F: "#b87a14", m1: "#e29f1f", s: "#fff3b0", w: "#ffe28a" }
  },
  fish_koi: {
    rarity: "rare",
    body: CARP({
      marks: (m) => {
        const red: Ellipse[] = [{ t: 0.28, r: 0.32, a: 0.14, b: 0.5 }, { t: 0.58, r: 0.55, a: 0.16, b: 0.55 }, { t: 0.84, r: 0.25, a: 0.08, b: 0.4 }];
        const blk: Ellipse[] = [{ t: 0.46, r: 0.15, a: 0.07, b: 0.3 }, { t: 0.2, r: 0.75, a: 0.06, b: 0.3 }];
        if (red.some((e) => inEllipse(e, m.t, m.r))) return "1";
        if (blk.some((e) => inEllipse(e, m.t, m.r))) return "2";
        return undefined;
      }
    }),
    colors: { b: "#f1ece0", d: "#d9d2c2", l: "#ffffff", f: "#efe6d6", F: "#d7c9b0", m1: "#e8472f", m2: "#2a2a35", w: "#f1ece0" }
  },
  fish_sturgeon: {
    rarity: "rare",
    body: {
      x0: 4, x1: 27, hmax: 3.3, tp: 0.36, p: 2.0, tailMin: 1.0, headMin: 0.7, topF: 1.05, botF: 0.72,
      tail: { len: 5, h: 2.8, fork: 2, upper: 3 },
      topFins: [top(0.64, 0.8, 2.6)],
      botFins: [top(0.7, 0.84, 1.8)],
      eye: { dx: 6, row: 1 }, gill: 8, pect: { dx: 11, dy: 1 },
      marks: (m) => {
        if (m.r < 0.1 && m.x % 2 === 0) return "s";
        if (m.r > 0.4 && m.r < 0.6 && m.x % 3 === 0 && m.t > 0.08 && m.t < 0.78) return "s";
        return undefined;
      },
      extras: (g, i) => {
        const y = Math.round(i.cy) + 1;
        setPx(g, i.x1 + 1, y, "w"); setPx(g, i.x1 - 2, y + 1, "w"); setPx(g, i.x1 - 3, y + 1, "w");
      }
    },
    colors: { b: "#6f8296", d: "#46586d", l: "#c4c9c0", f: "#5b6c80", s: "#d3d9d8", w: "#d8d4bc" }
  },
  fish_eel: {
    rarity: "rare",
    body: {
      x0: 2, x1: 29, hmax: 1.8, tp: 0.5, p: 3, tailMin: 0.7, headMin: 1.1, topF: 1, botF: 1,
      cy: 8,
      wave: { amp: 2.4, freq: 1.25, phase: 0.4 },
      tail: { len: 0, h: 1 },
      topFins: [top(0.08, 0.86, 1)],
      botFins: [top(0.2, 0.86, 1)],
      eye: { dx: 3, row: 1 }, gill: 5, pect: { dx: 6, dy: 1 },
      marks: (m) => (m.r > 0.4 && m.r < 0.6 && m.x % 3 === 0 ? "s" : undefined)
    },
    colors: { b: "#5a6b3c", d: "#3a4a2a", l: "#c9c070", f: "#4a5a34", F: "#3a4a2a", s: "#8a9a5a" }
  },
  fish_rainbow_trout: {
    rarity: "rare",
    body: TROUT({
      marks: (m) => {
        if (m.r > 0.4 && m.r < 0.62 && m.t > 0.08) return "1";
        if (m.r >= 0.25 && m.r <= 0.4 && m.t > 0.08 && m.x % 2 === 0) return "2";
        if (m.r < 0.4 && hash2(m.x, m.y, 8) < 0.16) return "3";
        return undefined;
      }
    }),
    colors: { b: "#9cb8a0", d: "#6b8f7a", l: "#eef2e2", f: "#8fb0a0", m1: "#f0607c", m2: "#7cc4f0", m3: "#3a4a52" }
  },

  // ---------------- epic ----------------
  fish_moonlight_carp: {
    rarity: "epic",
    body: CARP({
      x0: 9, x1: 27, hmax: 4.7, extras: undefined,
      tail: { len: 8, h: 5.4, fork: 3, flow: 1.6 },
      topFins: [top(0.2, 0.8, 3)],
      botFins: [top(0.55, 0.8, 2.4)],
      marks: (m) => {
        // crescent moon on the flank
        const cx = 0.5, cy = 0.5;
        const d1 = ((m.t - cx) / 0.17) ** 2 + ((m.r - cy) / 0.38) ** 2;
        const d2 = ((m.t - cx - 0.07) / 0.15) ** 2 + ((m.r - cy) / 0.34) ** 2;
        if (d1 < 1 && d2 >= 1) return "1";
        if (m.r < 0.2 && m.x % 2 === 1) return "s";
        return undefined;
      }
    }),
    colors: { b: "#aebfe6", d: "#7f94d0", l: "#e6edff", f: "#a39ae8", F: "#7b6fd0", s: "#f4f7ff", m1: "#fff3a8", w: "#e6edff" }
  },
  fish_starry_trout: {
    rarity: "epic",
    body: TROUT({
      x0: 5, x1: 28,
      marks: (m) => {
        const v = hash2(m.x, m.y, 21);
        if (v < 0.075) return "1";
        if (v < 0.11 && m.r > 0.5) return "2";
        return undefined;
      },
      topFins: [top(0.36, 0.6, 2.6), top(0.16, 0.22, 1)],
      tail: { len: 6, h: 4.6, fork: 3 }
    }),
    colors: { b: "#4a4fa8", d: "#2e3178", l: "#8f94e0", f: "#6a5fc8", F: "#4a3fa0", m1: "#ffe88a", m2: "#bfe9ff" }
  },
  fish_jade_dragonfish: {
    rarity: "epic",
    body: {
      x0: 5, x1: 26, hmax: 3.4, tp: 0.45, p: 2.6, tailMin: 1.2, headMin: 1.6, topF: 1.15, botF: 0.8,
      tail: { len: 5, h: 3, fork: 0, flow: 1 },
      topFins: [top(0.36, 0.96, 2.2)],
      botFins: [top(0.36, 0.96, 2.2)],
      eye: { dx: 3, row: 1 }, gill: 6, pect: { dx: 7, dy: 1 },
      marks: (m) => ((m.x + m.y) % 2 === 0 && m.r > 0.15 && m.r < 0.85 && m.t > 0.1 ? "1" : undefined),
      extras: (g, i) => {
        const y = Math.round(i.cy);
        // whiskers
        setPx(g, i.x1 + 1, y + 1, "w"); setPx(g, i.x1 + 2, y + 2, "w"); setPx(g, i.x1 + 3, y + 2, "w"); setPx(g, i.x1 + 4, y + 3, "w");
        setPx(g, i.x1 - 3, y - 3, "w"); setPx(g, i.x1 - 2, y - 4, "w"); setPx(g, i.x1 - 1, y - 4, "w");
        // gold eye ring accent
      }
    },
    colors: { b: "#3fbf90", d: "#1f8a6c", l: "#aaf0d0", f: "#58dcb0", F: "#2aa07c", m1: "#7ae8bc", w: "#ffd36b" }
  },

  // ---------------- legendary ----------------
  fish_lake_guardian: {
    rarity: "legendary",
    body: {
      x0: 8, x1: 27, hmax: 5.2, tp: 0.42, p: 2.4, tailMin: 1.6, headMin: 2.2, topF: 1.05, botF: 0.95,
      tail: { len: 7, h: 5.6, fork: 3, flow: 1.4 },
      topFins: [top(0.1, 0.8, 3.4, true)],
      botFins: [top(0.5, 0.78, 2.4), top(0.18, 0.32, 1.6)],
      eye: { dx: 4, row: 2 }, gill: 7, pect: { dx: 8, dy: 1 },
      marks: (m) => ((m.x + m.y * 2) % 3 === 0 && m.ch !== "l" && m.r > 0.1 ? "1" : m.r < 0.15 && m.t > 0.6 && m.x % 2 === 0 ? "s" : undefined),
      extras: (g, i) => {
        // golden crown
        const x = i.x1 - 4;
        const y = i.topPx[x];
        setPx(g, x, y - 1, "s"); setPx(g, x, y - 2, "s"); setPx(g, x + 2, y - 1, "s"); setPx(g, x + 2, y - 3, "s"); setPx(g, x + 2, y - 2, "s");
        setPx(g, x - 2, y - 1, "s");
        // pearl
        setPx(g, i.x1 - 1, y + 1, "w");
      }
    },
    colors: { b: "#2f94c4", d: "#1d5f9a", l: "#a6e6ff", f: "#ffc93a", F: "#d9941e", m1: "#4cb2dc", s: "#ffe27a", w: "#ffffff" }
  },
  fish_moonshadow: {
    rarity: "legendary",
    body: {
      x0: 8, x1: 27, hmax: 3.5, tp: 0.4, p: 2.4, tailMin: 1.2, headMin: 1.5, topF: 1, botF: 0.95,
      tail: { len: 8, h: 5.2, fork: 4, flow: 2 },
      topFins: [top(0.28, 0.82, 3.6)],
      botFins: [top(0.4, 0.8, 2.8)],
      eye: { dx: 4, row: 1 }, gill: 7,
      marks: (m) => {
        const d1 = ((m.t - 0.86) / 0.12) ** 2 + ((m.r - 0.3) / 0.35) ** 2;
        const d2 = ((m.t - 0.9) / 0.11) ** 2 + ((m.r - 0.3) / 0.3) ** 2;
        if (d1 < 1 && d2 >= 1 && m.t < 0.99) return "1";
        if (hash2(m.x, m.y, 31) < 0.09) return "2";
        return undefined;
      }
    },
    colors: { b: "#cfcdfb", d: "#9a96e0", l: "#f4f2ff", f: withAlpha("#d6ccff", 0.85), F: withAlpha("#a79cf0", 0.9), o: "#4a4690", m1: "#fff0a8", m2: "#ffffff", s: "#ffffff" }
  }
};

/** Old id kept as an alias so stale saves/UI still render. */
const ALIASES: Record<string, string> = { fish_cultrure: "fish_xenocypris" };

const SILHOUETTE_COLOR = "#1b2434";
const SPARKLE_SPOTS: [number, number][] = [[3, 3], [28, 3], [4, 13], [27, 13], [15, 1], [16, 14], [10, 2], [22, 14]];

function paletteFor(c: Colors, rarity: FishRarity): Palette {
  const d = c.d ?? mix(c.b, "#1b2540", 0.28);
  const f = c.f ?? mix(c.b, d, 0.6);
  const pal: Palette = {
    b: c.b,
    d,
    l: c.l ?? lighten(c.b, 0.45),
    f,
    F: c.F ?? darken(f, 0.25),
    g: darken(d, 0.2),
    o: c.o ?? mix(d, "#0f1424", 0.62),
    e: "#fbfbf2",
    k: "#141a2a",
    s: c.s ?? lighten(c.b, 0.7),
    w: c.w ?? lighten(c.b, 0.4),
    "1": c.m1 ?? c.b,
    "2": c.m2 ?? d,
    "3": c.m3 ?? d
  };
  if (rarity === "epic" || rarity === "legendary") {
    const col = RARITY_COLORS[rarity];
    pal.H = withAlpha(col, rarity === "legendary" ? 0.55 : 0.42);
    pal.h = withAlpha(col, 0.2);
    pal.X = withAlpha(col, 0.95);
    pal.Y = "#ffffff";
  }
  return pal;
}

function hashStr(s: string): number {
  let h = 7;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function buildFish(id: string): SpriteMap {
  const sp = SPECIES[id];
  const { grid } = buildBody({ W, H, ...sp.body });
  addOutline(grid, "o");
  if (sp.rarity === "epic" || sp.rarity === "legendary") {
    addHalo(grid, "H", "h");
    const count = sp.rarity === "legendary" ? 3 : 2;
    const start = hashStr(id) % SPARKLE_SPOTS.length;
    let placed = 0;
    for (let k = 0; k < SPARKLE_SPOTS.length && placed < count; k++) {
      const [x, y] = SPARKLE_SPOTS[(start + k) % SPARKLE_SPOTS.length];
      if (addSparkle(grid, x, y, "Y", "X")) placed++;
    }
  }
  return gridToMap(grid, paletteFor(sp.colors, sp.rarity));
}

const mapCache = new Map<string, SpriteMap>();

function resolveId(fishId: string): string | undefined {
  const id = ALIASES[fishId] ?? fishId;
  return SPECIES[id] ? id : undefined;
}

/** True if a sprite exists for this fish id (old `fish_cultrure` is aliased to `fish_xenocypris`). */
export function hasFishSprite(fishId: string): boolean {
  return resolveId(fishId) !== undefined;
}

/** All fish ids that have sprites. */
export const FISH_SPRITE_IDS: string[] = Object.keys(SPECIES);

/** Rarity of a sprite species (used for decoration). */
export function getFishSpriteRarity(fishId: string): FishRarity | undefined {
  const id = resolveId(fishId);
  return id ? SPECIES[id].rarity : undefined;
}

/** Raw sprite map (rows + palette) for a fish id. Pure data, no DOM. */
export function getFishSpriteMap(fishId: string): SpriteMap {
  const id = resolveId(fishId);
  if (!id) throw new Error(`No fish sprite for ${fishId}`);
  let m = mapCache.get(id);
  if (!m) {
    m = buildFish(id);
    mapCache.set(id, m);
  }
  return m;
}

/** Silhouette version of a sprite map: every pixel one dark color; glow/sparkle removed. */
export function toSilhouetteMap(map: SpriteMap, color = SILHOUETTE_COLOR): SpriteMap {
  const rows = map.rows.map((r) => r.replace(/[HhXY]/g, ".").replace(/[^.]/g, "o"));
  return { rows, palette: { o: color } };
}

const QUESTION: SpriteMap = {
  rows: [".ooo.", "o...o", "....o", "..oo.", "..o..", ".....", "..o.."],
  palette: { o: SILHOUETTE_COLOR }
};

function fishParsed(fishId: string, opts?: FishSpriteOptions): ParsedSprite {
  const id = resolveId(fishId);
  if (!id) return parseSprite(QUESTION);
  const base = getFishSpriteMap(id);
  return parseSprite(opts?.silhouette ? toSilhouetteMap(base, opts.silhouetteColor) : base);
}

const keyOf = (fishId: string, opts?: FishSpriteOptions) =>
  `fish:${resolveId(fishId) ?? "?"}${opts?.silhouette ? `:sil:${opts.silhouetteColor ?? ""}` : ""}`;

/** Cached offscreen canvas of a fish sprite at an integer scale. */
export function getFishCanvas(fishId: string, scale: number, opts?: FishSpriteOptions): HTMLCanvasElement {
  return getCachedCanvas(keyOf(fishId, opts), scale, () => fishParsed(fishId, opts));
}

/**
 * Data URL (PNG) of a fish sprite for use in `<img>`; cached. Use
 * `image-rendering: pixelated` in CSS when displaying at non-native size.
 * Sprite is 32x16 px at scale 1.
 */
export function getFishSpriteDataUrl(fishId: string, scale: number, opts?: FishSpriteOptions): string {
  return getCachedDataUrl(keyOf(fishId, opts), scale, () => fishParsed(fishId, opts));
}

/** Draw a fish sprite (top-left at x,y in canvas pixels; integer scale, no smoothing). */
export function drawFish(ctx: CanvasRenderingContext2D, fishId: string, x: number, y: number, scale: number, opts?: FishSpriteOptions): void {
  const c = getFishCanvas(fishId, scale, opts);
  const prev = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(c, Math.round(x), Math.round(y));
  ctx.imageSmoothingEnabled = prev;
}
