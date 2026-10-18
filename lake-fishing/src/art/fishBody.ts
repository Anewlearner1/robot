/**
 * Parametric fish body builder. Produces a character grid (facing right) using
 * role characters, which species palettes then color:
 *   o outline  b body  d back  l belly  f fin  F fin-dark  g gill/shade
 *   e eye-white  k pupil  s sheen  w whisker  1 2 3 species marks
 */

export type Grid = string[][];

export interface FinSpec {
  /** Start/end along body, 0..1 from tail to snout. */
  a: number;
  b: number;
  h: number;
  spiky?: boolean;
}

export interface BodySpec {
  W: number;
  H: number;
  x0: number;
  x1: number;
  cy?: number;
  hmax: number;
  /** Position of max depth, 0..1 (tail -> snout). */
  tp: number;
  /** Superellipse exponent; 2 = ellipse, larger = fuller. */
  p?: number;
  tailMin?: number;
  headMin?: number;
  topF?: number;
  botF?: number;
  wave?: { amp: number; freq: number; phase?: number };
  tail: { len: number; h: number; fork?: number; flow?: number; upper?: number };
  topFins?: FinSpec[];
  botFins?: FinSpec[];
  pect?: { dx: number; dy?: number } | false;
  eye: { dx: number; row: number };
  gill?: number;
  /** Per-pixel mark hook; return a char to override a body pixel. */
  marks?: (m: MarkCtx) => string | undefined;
  extras?: (g: Grid, info: BodyInfo) => void;
}

export interface MarkCtx {
  x: number;
  y: number;
  /** 0 at tail joint .. 1 at snout */
  t: number;
  /** 0 at top of body column .. 1 at bottom */
  r: number;
  ch: string;
}

export interface BodyInfo {
  x0: number;
  x1: number;
  cy: number;
  topPx: number[];
  botPx: number[];
  center: (x: number) => number;
}

export const blank = (W: number, H: number): Grid => Array.from({ length: H }, () => new Array<string>(W).fill("."));

export function setPx(g: Grid, x: number, y: number, ch: string, overwrite = true): void {
  if (y < 0 || y >= g.length || x < 0 || x >= g[0].length) return;
  if (!overwrite && g[y][x] !== ".") return;
  g[y][x] = ch;
}

/** Small deterministic hash -> 0..1 */
export function hash2(x: number, y: number, seed = 0): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return ((h >>> 0) % 10007) / 10007;
}

const BODY_CHARS = "bdl";

export function buildBody(s: BodySpec): { grid: Grid; info: BodyInfo } {
  const { W, H, x0, x1 } = s;
  const cy = s.cy ?? H / 2;
  const p = s.p ?? 2.2;
  const tailMin = s.tailMin ?? 1;
  const headMin = s.headMin ?? 1;
  const topF = s.topF ?? 1;
  const botF = s.botF ?? 1;
  const g = blank(W, H);
  const span = x1 - x0 + 1;

  const center = (x: number): number => {
    if (!s.wave) return cy;
    const t = (x + 0.5 - x0) / span;
    return cy + s.wave.amp * Math.sin(2 * Math.PI * s.wave.freq * t + (s.wave.phase ?? 0));
  };

  const half = (t: number): number => {
    const left = t < s.tp;
    const w = left ? s.tp : 1 - s.tp;
    const u = Math.min(1, Math.abs(t - s.tp) / w);
    const shape = Math.pow(Math.max(0, 1 - Math.pow(u, p)), 1 / p);
    return Math.max(s.hmax * shape, left ? tailMin : headMin);
  };

  const topPx: number[] = new Array(W).fill(-1);
  const botPx: number[] = new Array(W).fill(-1);

  // body fill + shading
  for (let x = x0; x <= x1; x++) {
    const t = (x + 0.5 - x0) / span;
    const hh = half(t);
    const c = center(x);
    const yt = c - hh * topF;
    const yb = c + hh * botF;
    let first = -1;
    let last = -1;
    for (let y = 0; y < H; y++) {
      if (y + 0.5 >= yt && y + 0.5 <= yb) {
        if (first < 0) first = y;
        last = y;
      }
    }
    if (first < 0) continue;
    topPx[x] = first;
    botPx[x] = last;
    const n = last - first + 1;
    const topN = n >= 3 ? Math.max(1, Math.round(n * 0.26)) : 0;
    const botN = n >= 4 ? Math.max(1, Math.round(n * 0.28)) : n === 3 ? 1 : 0;
    for (let y = first; y <= last; y++) {
      let ch = "b";
      if (y - first < topN) ch = "d";
      else if (last - y < botN) ch = "l";
      g[y][x] = ch;
    }
  }

  // tail
  const tl = s.tail.len;
  for (let d = 1; d <= tl; d++) {
    const x = x0 - d;
    if (x < 0) continue;
    const e = d / tl;
    const h = tailMin + (s.tail.h - tailMin) * Math.pow(e, 0.8);
    const flow = s.tail.flow ? s.tail.flow * Math.sin(e * Math.PI * 1.1) * e : 0;
    const c = center(x0) + flow;
    const fork = s.tail.fork ?? 0;
    const notch = fork > 0 && d > tl - fork ? (d - (tl - fork) + 0.4) * 0.85 : 0;
    // upper lobe lengthening for heterocercal tails
    const up = s.tail.upper ? (e > 0.6 ? s.tail.upper * (e - 0.6) : 0) : 0;
    for (let y = 0; y < H; y++) {
      const dy = y + 0.5 - c;
      const inUp = dy < 0 && -dy <= h + up;
      const inDn = dy >= 0 && dy <= h;
      if (!(inUp || inDn)) continue;
      if (Math.abs(dy) < notch) continue;
      g[y][x] = (y + d) % 3 === 0 && e > 0.35 ? "F" : "f";
    }
  }

  // fins
  const placeFins = (fins: FinSpec[] | undefined, dir: -1 | 1) => {
    for (const f of fins ?? []) {
      for (let x = x0; x <= x1; x++) {
        const t = (x + 0.5 - x0) / span;
        if (t < f.a || t > f.b) continue;
        const u = (t - f.a) / Math.max(0.0001, f.b - f.a);
        let hh = Math.round(f.h * Math.pow(1 - u, 0.65) + 0.35);
        if (f.spiky) hh += x % 2 === 0 ? 0 : -1;
        const base = dir < 0 ? topPx[x] : botPx[x];
        if (base < 0) continue;
        for (let k = 1; k <= hh; k++) setPx(g, x, base + dir * k, k === hh && hh > 1 ? "F" : "f", false);
      }
    }
  };
  placeFins(s.topFins, -1);
  placeFins(s.botFins, 1);

  // pectoral fin
  if (s.pect !== false) {
    const dx = s.pect?.dx ?? 8;
    const dy = s.pect?.dy ?? 1;
    const px = x1 - dx;
    const py = Math.round(center(px)) + dy;
    for (const [ox, oy] of [[0, 0], [-1, 0], [-1, 1], [-2, 1], [-2, 2]] as const) {
      const ch = g[py + oy]?.[px + ox];
      if (ch && BODY_CHARS.includes(ch)) g[py + oy][px + ox] = "f";
    }
  }

  const info: BodyInfo = { x0, x1, cy, topPx, botPx, center };

  // marks
  if (s.marks) {
    for (let x = x0; x <= x1; x++) {
      if (topPx[x] < 0) continue;
      const n = botPx[x] - topPx[x] + 1;
      for (let y = topPx[x]; y <= botPx[x]; y++) {
        const ch = g[y][x];
        if (!BODY_CHARS.includes(ch)) continue;
        const r = n > 1 ? (y - topPx[x]) / (n - 1) : 0.5;
        const m = s.marks({ x, y, t: (x + 0.5 - x0) / span, r, ch });
        if (m) g[y][x] = m;
      }
    }
  }

  // gill line
  if (s.gill) {
    const gx = x1 - s.gill;
    for (let y = topPx[gx] + 1; y <= botPx[gx] - 1; y++) {
      if (BODY_CHARS.includes(g[y]?.[gx] ?? "")) g[y][gx] = "g";
    }
  }

  s.extras?.(g, info);

  // eye
  const ex = x1 - s.eye.dx;
  const ey = (topPx[ex] >= 0 ? topPx[ex] : Math.round(cy)) + s.eye.row;
  setPx(g, ex, ey, "k");
  setPx(g, ex - 1, ey, "e");
  setPx(g, ex, ey - 1, "e");

  return { grid: g, info };
}

/** Add an outside outline ring of `ch` around all non-empty pixels. */
export function addOutline(g: Grid, ch: string): void {
  const H = g.length;
  const W = g[0].length;
  const add: [number, number][] = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (g[y][x] !== ".") continue;
      if ((g[y - 1]?.[x] ?? ".") !== "." || (g[y + 1]?.[x] ?? ".") !== "." || (g[y]?.[x - 1] ?? ".") !== "." || (g[y]?.[x + 1] ?? ".") !== ".") {
        add.push([x, y]);
      }
    }
  }
  for (const [x, y] of add) g[y][x] = ch;
}

/** Add a soft halo: ring 1 (`ch1`) around non-empty pixels (4-neighbour), optional ring 2 (`ch2`, 8-neighbour of ring 1). */
export function addHalo(g: Grid, ch1: string, ch2?: string): void {
  const H = g.length;
  const W = g[0].length;
  const at = (x: number, y: number) => g[y]?.[x] ?? ".";
  const ring1: [number, number][] = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (g[y][x] !== ".") continue;
      if (at(x, y - 1) !== "." || at(x, y + 1) !== "." || at(x - 1, y) !== "." || at(x + 1, y) !== ".") ring1.push([x, y]);
    }
  }
  for (const [x, y] of ring1) g[y][x] = ch1;
  if (!ch2) return;
  const ring2: [number, number][] = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (g[y][x] !== ".") continue;
      if (at(x, y - 1) === ch1 || at(x, y + 1) === ch1 || at(x - 1, y) === ch1 || at(x + 1, y) === ch1) ring2.push([x, y]);
    }
  }
  for (const [x, y] of ring2) g[y][x] = ch2;
}

/** Place a plus-shaped sparkle (center `c`, arms `a`) if all five cells are free (halo cells count as free). */
export function addSparkle(g: Grid, x: number, y: number, c: string, a: string, free = ".Hh"): boolean {
  const cells: [number, number][] = [[x, y], [x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
  for (const [cx, cy] of cells) {
    const ch = g[cy]?.[cx];
    if (ch === undefined || !free.includes(ch)) return false;
  }
  g[y][x] = c;
  g[y][x - 1] = a;
  g[y][x + 1] = a;
  g[y - 1][x] = a;
  g[y + 1][x] = a;
  return true;
}
