import type { FishRarity } from "../types/game";
import { addOutline, blank, buildBody } from "./fishBody";
import { RARITY_COLORS, hexToRgb, lighten, mix, withAlpha } from "./palette";
import { BIRD_FRAMES, BUBBLE_MAP, CLOUD_MAPS, FISHER_MAP, FISHER_OUTLINE } from "./sceneSprites";
import { type ParsedSprite, type SpriteMap, createCanvas, get2d, gridToMap, parseSprite, renderSprite, rotateSprite } from "./sprite";
import type { TimeOfDay } from "./time";

export type { TimeOfDay };

export type ScenePhase = "waiting" | "bite" | "catch";

export interface SceneState {
  timeOfDay: TimeOfDay;
  phase: ScenePhase;
  /** Rarity of the fish being caught (tints splash / jump). Used in 'catch'. */
  catchRarity?: FishRarity;
}

export interface LakeScene {
  /** Draw one frame. `nowMs` is any monotonic ms clock (e.g. performance.now()). */
  render(state: SceneState, nowMs: number): void;
  /** Resize backing store. cssWidth/cssHeight in CSS px; dpr = devicePixelRatio. */
  resize(cssWidth: number, cssHeight: number, dpr: number): void;
  destroy(): void;
}

// ---------------------------------------------------------------- looks
interface Look {
  sky: string[];
  sun: string;
  sunGlow: string;
  far: string;
  near: string;
  trees: string;
  water: string[];
  shimmer: string;
  cloud: [string, string, string];
  tint: string;
  tintAmt: number;
}

const LOOKS: Record<TimeOfDay, Look> = {
  dawn: {
    sky: ["#7d8fc9", "#a39ad0", "#d0a2c8", "#eca9b0", "#f6bd9a", "#fbd5a4"],
    sun: "#ffe3a6", sunGlow: "#ffb98a",
    far: "#a08fbd", near: "#7f739f", trees: "#5b5a82",
    water: ["#f0c8b2", "#d4adb8", "#b19cc0", "#8d8bb6", "#6f7ea8", "#5d6e9c"],
    shimmer: "#fff1d4", cloud: ["#fff1e8", "#f6cdc6", "#d9a6b8"],
    tint: "#ffb38a", tintAmt: 0.14
  },
  day: {
    sky: ["#4f9fe0", "#6cb4ea", "#8cc7f0", "#abd8f4", "#c8e8f6", "#e0f3f6"],
    sun: "#fff3a6", sunGlow: "#fff9cf",
    far: "#8fb4cf", near: "#6a9fae", trees: "#3f7d5c",
    water: ["#a8dde6", "#82cae0", "#62b4d4", "#4c9fc8", "#3f8cb8", "#357aa6"],
    shimmer: "#eafcff", cloud: ["#ffffff", "#e8f3fb", "#c4dcee"],
    tint: "#ffffff", tintAmt: 0
  },
  dusk: {
    sky: ["#3f4a8c", "#5d4f94", "#8c5a9c", "#c0668c", "#e88478", "#f6ac6c"],
    sun: "#ffb85e", sunGlow: "#ff8a5a",
    far: "#6e5a8c", near: "#52437a", trees: "#382f5c",
    water: ["#f2a47c", "#c8808c", "#92709c", "#665c9c", "#4d4c8a", "#3d3e76"],
    shimmer: "#ffd6a6", cloud: ["#ffcaa2", "#e88c8e", "#a8627e"],
    tint: "#ff8a5a", tintAmt: 0.2
  },
  night: {
    sky: ["#0a0e2a", "#10163a", "#171f4a", "#202a5c", "#2b386e", "#374880"],
    sun: "#f3f1d8", sunGlow: "#9fb0e8",
    far: "#27336a", near: "#1d2858", trees: "#111a40",
    water: ["#34467f", "#2a3b72", "#213262", "#192754", "#131f46", "#0d1838"],
    shimmer: "#a8bcf0", cloud: ["#4d5d99", "#38417c", "#282e64"],
    tint: "#1c2a66", tintAmt: 0.45
  }
};

const MIN_LW = 120;
const TARGET_LW = 160;
const MAX_LH = 300;

// ---------------------------------------------------------------- helpers
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const smooth = (t: number) => t * t * (3 - 2 * t);

/** Vertical gradient as ordered-dither bands. */
function ditherBands(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, colors: string[], zone = 7): void {
  const img = ctx.createImageData(w, h);
  const rgb = colors.map(hexToRgb);
  const n = rgb.length;
  const bandH = h / n;
  for (let j = 0; j < h; j++) {
    const pos = j / bandH; // 0..n
    const band = Math.min(n - 1, Math.floor(pos));
    // distance to next boundary in pixels
    const toNext = (band + 1) * bandH - j;
    let p = 0;
    if (band < n - 1 && toNext < zone / 2) p = 0.5 + (zone / 2 - toNext) / zone;
    else if (band > 0 && j - band * bandH < zone / 2) p = 0.5 - (j - band * bandH) / zone;
    for (let i = 0; i < w; i++) {
      let c = rgb[band];
      if (band < n - 1 && toNext < zone / 2) {
        if (p > BAYER[(j & 3) * 4 + (i & 3)] / 16) c = rgb[band + 1];
      } else if (band > 0 && j - band * bandH < zone / 2) {
        if (p > BAYER[(j & 3) * 4 + (i & 3)] / 16) c = rgb[band - 1];
      }
      const o = (j * w + i) * 4;
      img.data[o] = c.r;
      img.data[o + 1] = c.g;
      img.data[o + 2] = c.b;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, x, y);
}

function disc(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  ctx.fillStyle = color;
  for (let dy = -r; dy <= r; dy++) {
    const half = Math.floor(Math.sqrt(r * r + r * 0.6 - dy * dy));
    if (half >= 0) ctx.fillRect(Math.round(cx) - half, Math.round(cy) + dy, half * 2 + 1, 1);
  }
}

function line(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, size = 1): void {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (let guard = 0; guard < 600; guard++) {
    ctx.fillRect(x0, y0, size, size);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

function ripple(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string, alpha: number): void {
  if (alpha <= 0.02 || r < 1) return;
  ctx.globalAlpha = clamp(alpha, 0, 1);
  ctx.fillStyle = color;
  const steps = Math.max(8, Math.round(r * 5));
  let lx = NaN, ly = NaN;
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const x = Math.round(cx + Math.cos(a) * r);
    const y = Math.round(cy + Math.sin(a) * r * 0.34);
    if (x === lx && y === ly) continue;
    ctx.fillRect(x, y, 1, 1);
    lx = x; ly = y;
  }
  ctx.globalAlpha = 1;
}

function tintColor(c: string, look: Look): string {
  if (!c.startsWith("#")) return c;
  return look.tintAmt > 0 ? mix(c, look.tint, look.tintAmt) : c;
}

function tintMap(map: SpriteMap, look: Look): SpriteMap {
  const palette: Record<string, string> = {};
  for (const [k, v] of Object.entries(map.palette)) palette[k] = tintColor(v, look);
  return { rows: map.rows, palette };
}

function strMapToParsed(rows: string[], colors: Record<string, string>): ParsedSprite {
  return parseSprite({ rows, palette: colors });
}

// ---------------------------------------------------------------- layout & layers
interface Layout {
  S: number;
  cw: number;
  ch: number;
  LW: number;
  LH: number;
  offX: number;
  offY: number;
  horizon: number;
  dockY: number;
  dockEnd: number;
  fx: number;
  fy: number;
  handX: number;
  handY: number;
  tipX: number;
  tipY: number;
  bobX: number;
  bobY: number;
  sunX: number;
  sunY: number;
}

function computeLayout(cw: number, ch: number): Layout {
  const S = Math.max(1, Math.round(cw / TARGET_LW));
  const LW = Math.max(MIN_LW, Math.ceil(cw / S));
  const LH = Math.min(MAX_LH, Math.max(100, Math.ceil(ch / S)));
  const offX = 0;
  const offY = Math.floor((ch - LH * S) / 2);
  const horizon = Math.round(LH * 0.38);
  const dockY = Math.round(LH * 0.77);
  const dockEnd = Math.round(LW * 0.46);
  const fx = dockEnd - 10;
  const fy = dockY - 14;
  const handX = fx + 12;
  const handY = fy + 9;
  const tipX = handX + 25;
  const tipY = handY - 31;
  const bobX = Math.min(LW - 16, tipX + 8);
  const bobY = Math.round(LH * 0.65);
  return { S, cw, ch, LW, LH, offX, offY, horizon, dockY, dockEnd, fx, fy, handX, handY, tipX, tipY, bobX, bobY, sunX: 0, sunY: 0 };
}

interface Layers {
  sky: HTMLCanvasElement;
  mountains: HTMLCanvasElement;
  water: HTMLCanvasElement;
  props: HTMLCanvasElement;
  fisher: HTMLCanvasElement;
  clouds: HTMLCanvasElement[];
  stars: { x: number; y: number; ph: number; big: boolean }[];
  sunX: number;
  sunY: number;
}

function buildSky(L: Layout, look: Look, tod: TimeOfDay): { canvas: HTMLCanvasElement; stars: Layers["stars"]; sunX: number; sunY: number } {
  const c = createCanvas(L.LW, L.horizon + 1);
  const ctx = get2d(c);
  ditherBands(ctx, 0, 0, L.LW, L.horizon + 1, look.sky);
  const rnd = mulberry32(tod === "night" ? 11 : 5);
  const stars: Layers["stars"] = [];
  // sun / moon placement
  let sunX = Math.round(L.LW * 0.74);
  let sunY = Math.round(L.horizon * 0.34);
  if (tod === "dawn") { sunX = Math.round(L.LW * 0.24); sunY = L.horizon - 9; }
  if (tod === "dusk") { sunX = Math.round(L.LW * 0.76); sunY = L.horizon - 8; }
  if (tod === "night") { sunX = Math.round(L.LW * 0.72); sunY = Math.round(L.horizon * 0.3); }

  if (tod === "night") {
    for (let i = 0; i < 46; i++) {
      stars.push({ x: Math.floor(rnd() * L.LW), y: Math.floor(rnd() * (L.horizon - 12)), ph: rnd() * 6.28, big: rnd() < 0.18 });
    }
    ctx.fillStyle = "rgba(220,230,255,0.55)";
    for (const s of stars) ctx.fillRect(s.x, s.y, 1, 1);
  }
  if (tod === "dawn") {
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    for (let i = 0; i < 6; i++) ctx.fillRect(Math.floor(rnd() * L.LW), Math.floor(rnd() * L.horizon * 0.3), 1, 1);
  }

  // glow
  const glowR = tod === "day" ? 15 : tod === "night" ? 13 : 18;
  ctx.globalAlpha = tod === "night" ? 0.1 : 0.18;
  for (let k = 3; k >= 1; k--) disc(ctx, sunX, sunY, 6 + Math.round((glowR / 3) * k), look.sunGlow);
  ctx.globalAlpha = 1;
  // body
  if (tod !== "night") disc(ctx, sunX, sunY, 5, look.sun);
  if (tod === "night") {
    // crescent: full disc minus an offset disc, drawn per pixel
    ctx.fillStyle = look.sun;
    for (let dy = -6; dy <= 6; dy++) {
      for (let dx = -6; dx <= 6; dx++) {
        const inMoon = dx * dx + dy * dy <= 6 * 6 + 3;
        const cut = (dx - 3) * (dx - 3) + (dy + 2) * (dy + 2) <= 5.4 * 5.4;
        if (inMoon && !cut) ctx.fillRect(sunX + dx, sunY + dy, 1, 1);
      }
    }
    ctx.fillStyle = "#cfd0c0";
    ctx.fillRect(sunX - 4, sunY + 1, 2, 2);
    ctx.fillRect(sunX - 1, sunY + 4, 1, 1);
  } else {
    ctx.fillStyle = lighten(look.sun, 0.5);
    ctx.fillRect(sunX - 2, sunY - 3, 2, 1);
  }
  return { canvas: c, stars, sunX, sunY };
}

function buildMountains(L: Layout, look: Look, tod: TimeOfDay): HTMLCanvasElement {
  const c = createCanvas(L.LW, L.horizon + 1);
  const ctx = get2d(c);
  const rnd = mulberry32(42);
  const p1 = rnd() * 6, p2 = rnd() * 6, p3 = rnd() * 6;
  const maxH = Math.round(L.horizon * 0.5);
  // far ridge
  for (let x = 0; x < L.LW; x++) {
    const h = 0.5 + 0.28 * Math.sin(x * 0.045 + p1) + 0.16 * Math.sin(x * 0.11 + p2) + 0.07 * Math.sin(x * 0.27 + p3);
    const hh = Math.round(clamp(h, 0.1, 1) * maxH);
    ctx.fillStyle = look.far;
    ctx.fillRect(x, L.horizon - hh, 1, hh);
    ctx.fillStyle = lighten(look.far, tod === "night" ? 0.1 : 0.18);
    ctx.fillRect(x, L.horizon - hh, 1, 1);
  }
  // nearer hills
  for (let x = 0; x < L.LW; x++) {
    const h = 0.45 + 0.3 * Math.sin(x * 0.06 + p2 + 2) + 0.15 * Math.sin(x * 0.17 + p1);
    const hh = Math.round(clamp(h, 0.1, 1) * maxH * 0.42);
    ctx.fillStyle = look.near;
    ctx.fillRect(x, L.horizon - hh, 1, hh);
  }
  // treeline
  ctx.fillStyle = look.trees;
  ctx.fillRect(0, L.horizon - 3, L.LW, 4);
  for (let x = -2; x < L.LW + 4; x += 3 + Math.floor(rnd() * 3)) {
    const h = 5 + Math.floor(rnd() * 6);
    const half = 2 + (rnd() < 0.4 ? 1 : 0);
    for (let yy = 0; yy < h; yy++) {
      const w = Math.floor(((yy + 1) * half) / h);
      ctx.fillRect(x - w, L.horizon - h - 1 + yy, w * 2 + 1, 1);
    }
  }
  // tiny cabin light at night / dusk
  if (tod === "night" || tod === "dusk") {
    ctx.fillStyle = "#ffd36a";
    ctx.fillRect(Math.round(L.LW * 0.88), L.horizon - 3, 2, 1);
  }
  return c;
}

function buildWater(L: Layout, look: Look, mountains: HTMLCanvasElement): HTMLCanvasElement {
  const h = L.LH - L.horizon;
  const c = createCanvas(L.LW, h);
  const ctx = get2d(c);
  ditherBands(ctx, 0, 0, L.LW, h, look.water, 9);
  // mirrored shoreline reflection
  const depth = 22;
  ctx.save();
  ctx.globalAlpha = 0.28;
  ctx.translate(0, depth);
  ctx.scale(1, -1);
  ctx.drawImage(mountains, 0, L.horizon + 1 - depth, L.LW, depth, 0, 0, L.LW, depth);
  ctx.restore();
  // wobble: knock out every 3rd row in reflection for a ripple look
  ctx.fillStyle = look.water[0];
  ctx.globalAlpha = 0.5;
  for (let y = 2; y < depth; y += 4) ctx.fillRect(0, y, L.LW, 1);
  ctx.globalAlpha = 1;
  return c;
}

function buildProps(L: Layout, look: Look, tod: TimeOfDay): HTMLCanvasElement {
  const c = createCanvas(L.LW, L.LH);
  const ctx = get2d(c);
  const T = (col: string) => tintColor(col, look);
  const wood = [T("#c79a60"), T("#a97a46"), T("#7d5632"), T("#523720")];
  const rnd = mulberry32(7);

  // shadow under the dock
  ctx.fillStyle = "rgba(8,12,30,0.22)";
  ctx.fillRect(0, L.dockY + 6, L.dockEnd, L.LH - L.dockY - 6);

  // posts
  for (const px of [4, 26, 48, L.dockEnd - 5]) {
    if (px < 0 || px > L.dockEnd) continue;
    ctx.fillStyle = wood[3];
    ctx.fillRect(px, L.dockY + 4, 4, L.LH - L.dockY - 4);
    ctx.fillStyle = wood[2];
    ctx.fillRect(px, L.dockY + 4, 2, L.LH - L.dockY - 4);
    // waterline foam on post
    ctx.fillStyle = withAlpha(look.shimmer, 0.5);
    ctx.fillRect(px - 1, L.dockY + 13, 6, 1);
  }
  // beam
  ctx.fillStyle = wood[3];
  ctx.fillRect(0, L.dockY + 3, L.dockEnd, 4);
  ctx.fillStyle = wood[2];
  ctx.fillRect(0, L.dockY + 3, L.dockEnd, 2);
  // deck
  ctx.fillStyle = wood[1];
  ctx.fillRect(0, L.dockY, L.dockEnd + 1, 3);
  ctx.fillStyle = wood[0];
  ctx.fillRect(0, L.dockY, L.dockEnd + 1, 1);
  ctx.fillStyle = wood[2];
  for (let x = 5; x < L.dockEnd; x += 9 + Math.floor(rnd() * 3)) ctx.fillRect(x, L.dockY + 1, 1, 2);
  // end cap
  ctx.fillStyle = wood[2];
  ctx.fillRect(L.dockEnd, L.dockY, 1, 7);

  // lantern on the dock
  const lx = Math.max(6, L.fx - 14);
  ctx.fillStyle = T("#3b3a46");
  ctx.fillRect(lx, L.dockY - 9, 1, 9);
  ctx.fillRect(lx - 1, L.dockY - 10, 3, 1);
  ctx.fillStyle = tod === "night" || tod === "dusk" ? "#ffe08a" : T("#cdb98a");
  ctx.fillRect(lx - 1, L.dockY - 8, 3, 3);
  ctx.fillStyle = T("#3b3a46");
  ctx.fillRect(lx - 1, L.dockY - 5, 3, 1);

  // reeds + lily pads at the right
  const reedColor = [T("#2f6b4a"), T("#3f8a5a"), T("#274f3a")];
  for (let i = 0; i < 7; i++) {
    const x = L.LW - 4 - i * 4 - Math.floor(rnd() * 3);
    const h = 12 + Math.floor(rnd() * 14);
    const y0 = L.LH - 1 - h;
    ctx.fillStyle = reedColor[i % 3];
    const lean = i % 2 === 0 ? 0 : -1;
    ctx.fillRect(x, y0 + 2, 1, h - 1);
    ctx.fillRect(x + lean, y0 + 1, 1, 2);
    if (i % 2 === 0) {
      ctx.fillStyle = T("#7a4b2a");
      ctx.fillRect(x - 1, y0 - 3, 3, 5);
      ctx.fillStyle = T("#a06a3a");
      ctx.fillRect(x - 1, y0 - 3, 1, 5);
    }
  }
  for (const [lxp, lyp, big] of [[L.LW - 30, L.LH - 12, 1], [L.LW - 44, L.LH - 6, 0], [L.dockEnd + 14, L.LH - 8, 0]] as const) {
    ctx.fillStyle = T("#3f8a5a");
    ctx.fillRect(lxp - 3, lyp, big ? 8 : 6, 2);
    ctx.fillRect(lxp - 2, lyp - 1, big ? 6 : 4, 1);
    ctx.fillStyle = T("#2f6b4a");
    ctx.fillRect(lxp + 1, lyp, 1, 1);
    if (big) {
      ctx.fillStyle = T("#f6a8c0");
      ctx.fillRect(lxp, lyp - 2, 2, 2);
      ctx.fillStyle = T("#ffe9a0");
      ctx.fillRect(lxp, lyp - 1, 1, 1);
    }
  }
  return c;
}

function buildFisher(look: Look): HTMLCanvasElement {
  const map = tintMap(FISHER_MAP, look);
  const rows = map.rows.map((r) => r.split(""));
  const W = rows[0].length;
  // pad by 1 for outline
  const g = blank(W + 2, rows.length + 2);
  rows.forEach((r, y) => r.forEach((ch, x) => { g[y + 1][x + 1] = ch; }));
  addOutline(g, "o");
  const pal = { ...map.palette, o: tintColor(FISHER_OUTLINE, look) };
  return renderSprite(parseSprite(gridToMap(g, pal)), 1);
}

function buildClouds(look: Look): HTMLCanvasElement[] {
  return CLOUD_MAPS.map((m) => {
    const pal = { w: look.cloud[0], h: lighten(look.cloud[0], 0.35), s: look.cloud[2] };
    // mid tone for the body gradient
    pal.w = mix(look.cloud[0], look.cloud[1], 0.35);
    return renderSprite(strMapToParsed(m.rows, pal), 1);
  });
}

function buildLayers(L: Layout, tod: TimeOfDay): Layers {
  const look = LOOKS[tod];
  const sky = buildSky(L, look, tod);
  const mountains = buildMountains(L, look, tod);
  return {
    sky: sky.canvas,
    mountains,
    water: buildWater(L, look, mountains),
    props: buildProps(L, look, tod),
    fisher: buildFisher(look),
    clouds: buildClouds(look),
    stars: sky.stars,
    sunX: sky.sunX,
    sunY: sky.sunY
  };
}

// ---------------------------------------------------------------- jumping fish sprites
const JUMP_ANGLES = [-72, -54, -36, -18, 0, 18, 36, 54, 72];
const jumpCache = new Map<FishRarity, ParsedSprite[]>();

function buildJumpFish(rarity: FishRarity): ParsedSprite[] {
  const hit = jumpCache.get(rarity);
  if (hit) return hit;
  const col = RARITY_COLORS[rarity];
  const { grid } = buildBody({
    W: 22, H: 22, x0: 4, x1: 17, hmax: 2.9, tp: 0.45, p: 2.3, tailMin: 0.9, headMin: 1.1,
    tail: { len: 4, h: 3, fork: 2 },
    topFins: [{ a: 0.35, b: 0.62, h: 1.6, spiky: false }],
    botFins: [{ a: 0.55, b: 0.75, h: 1.2, spiky: false }],
    pect: false, eye: { dx: 3, row: 1 }
  });
  addOutline(grid, "o");
  const pal = {
    b: col, d: mix(col, "#1b2540", 0.3), l: lighten(col, 0.5), f: mix(col, "#1b2540", 0.15), F: mix(col, "#1b2540", 0.4),
    g: mix(col, "#1b2540", 0.4), o: mix(col, "#10162a", 0.72), e: "#ffffff", k: "#10162a", s: "#ffffff", w: "#ffffff",
    "1": col, "2": col, "3": col
  };
  const base = parseSprite(gridToMap(grid, pal));
  const out = JUMP_ANGLES.map((a) => rotateSprite(base, (a * Math.PI) / 180));
  jumpCache.set(rarity, out);
  return out;
}

const jumpCanvasCache = new Map<string, HTMLCanvasElement>();
function jumpCanvas(rarity: FishRarity, angleIdx: number): HTMLCanvasElement {
  const key = `${rarity}:${angleIdx}`;
  let c = jumpCanvasCache.get(key);
  if (!c) {
    c = renderSprite(buildJumpFish(rarity)[angleIdx], 1);
    jumpCanvasCache.set(key, c);
  }
  return c;
}

// ---------------------------------------------------------------- scene
export function createLakeScene(canvas: HTMLCanvasElement): LakeScene {
  const ctx = get2d(canvas);
  let destroyed = false;
  let L = computeLayout(canvas.width || 320, canvas.height || 400);
  let buffer = createCanvas(L.LW, L.LH);
  let bctx = get2d(buffer);
  const layerCache = new Map<TimeOfDay, Layers>();
  let lastPhase: ScenePhase | null = null;
  let phaseStart = 0;
  let lastRarity: FishRarity = "common";
  let bubble: HTMLCanvasElement | null = null;
  let shimmers: { x: number; y: number; len: number; sp: number; ph: number }[] = [];

  const bubbleCanvas = () => (bubble ??= renderSprite(parseSprite(BUBBLE_MAP), 1));

  function rebuildStatic(): void {
    layerCache.clear();
    buffer = createCanvas(L.LW, L.LH);
    bctx = get2d(buffer);
    const rnd = mulberry32(99);
    shimmers = [];
    const span = L.LH - L.horizon - 3;
    for (let i = 0; i < 52; i++) {
      const d = Math.pow(rnd(), 1.5);
      const y = L.horizon + 3 + Math.floor(d * span);
      shimmers.push({ x: Math.floor(rnd() * L.LW), y, len: 2 + Math.floor(d * 8 * (0.5 + rnd())), sp: 0.6 + rnd() * 1.4, ph: rnd() * 6.28 });
    }
  }
  rebuildStatic();

  function resize(cssWidth: number, cssHeight: number, dpr: number): void {
    if (destroyed) return;
    const cw = Math.max(1, Math.round(cssWidth * dpr));
    const chh = Math.max(1, Math.round(cssHeight * dpr));
    canvas.width = cw;
    canvas.height = chh;
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;
    ctx.imageSmoothingEnabled = false;
    L = computeLayout(cw, chh);
    rebuildStatic();
  }

  function splash(x: number, y: number, T: number, seed: number, color: string, count: number, power = 1): void {
    if (T < 0 || T > 1.1) return;
    const rnd = mulberry32(seed);
    for (let i = 0; i < count; i++) {
      const vx = (rnd() - 0.5) * 38 * power;
      const vy = -(18 + rnd() * 34) * power;
      const life = 0.6 + rnd() * 0.4;
      if (T > life) continue;
      const px = x + vx * T;
      const py = y + vy * T + 70 * T * T;
      if (py > y + 2) continue;
      bctx.globalAlpha = clamp(1 - T / life, 0, 1);
      bctx.fillStyle = color;
      const big = T < 0.25 && i % 3 === 0;
      bctx.fillRect(Math.round(px), Math.round(py), big ? 2 : 1, big ? 2 : 1);
    }
    bctx.globalAlpha = 1;
  }

  function render(state: SceneState, nowMs: number): void {
    if (destroyed) return;
    const tod = state.timeOfDay;
    const look = LOOKS[tod];
    let layers = layerCache.get(tod);
    if (!layers) {
      layers = buildLayers(L, tod);
      layerCache.set(tod, layers);
    }
    if (state.phase !== lastPhase) {
      lastPhase = state.phase;
      phaseStart = nowMs;
    }
    if (state.catchRarity) lastRarity = state.catchRarity;
    const t = nowMs / 1000;
    const pt = (nowMs - phaseStart) / 1000;
    const rarity = state.catchRarity ?? lastRarity;
    const rarityColor = RARITY_COLORS[rarity];
    const splashColor = rarity === "common" ? "#ffffff" : mix("#ffffff", rarityColor, 0.55);

    const b = bctx;
    b.globalAlpha = 1;
    // ---- sky
    b.drawImage(layers.sky, 0, 0);
    if (tod === "night") {
      for (const s of layers.stars) {
        const v = Math.sin(t * 1.6 + s.ph);
        if (v > 0.55) {
          b.fillStyle = s.big ? "#ffffff" : "#dfe8ff";
          b.fillRect(s.x, s.y, 1, 1);
          if (s.big && v > 0.9) {
            b.globalAlpha = 0.6;
            b.fillRect(s.x - 1, s.y, 3, 1);
            b.fillRect(s.x, s.y - 1, 1, 3);
            b.globalAlpha = 1;
          }
        }
      }
    }
    // ---- clouds
    const cloudSpecs = [
      { i: 0, y: 0.1, speed: 2.2, off: 0.05 },
      { i: 1, y: 0.2, speed: 1.5, off: 0.55 },
      { i: 2, y: 0.06, speed: 3.0, off: 0.85 },
      { i: 0, y: 0.27, speed: 1.1, off: 0.3 }
    ];
    for (const cs of cloudSpecs) {
      const cv = layers.clouds[cs.i];
      const span = L.LW + cv.width + 20;
      const x = ((cs.off * span + t * cs.speed) % span) - cv.width - 10;
      b.globalAlpha = tod === "night" ? 0.75 : 1;
      b.drawImage(cv, Math.round(x), Math.round(L.horizon * cs.y * 2.2));
    }
    b.globalAlpha = 1;
    // ---- far shore
    b.drawImage(layers.mountains, 0, 0);
    // ---- water
    b.drawImage(layers.water, 0, L.horizon + 1);
    // sun / moon path
    if (tod !== "day") {
      const px = layers.sunX;
      const strength = tod === "night" ? 0.55 : 0.7;
      for (let k = 0; k < 16; k++) {
        const w = 2 + Math.round(k * 0.5 + Math.sin(t * 1.3 + k * 1.7) * 1.5);
        const a = (1 - k / 16) * strength * (0.6 + 0.4 * Math.sin(t * 2 + k));
        b.globalAlpha = clamp(a, 0, 1);
        b.fillStyle = look.sun;
        b.fillRect(px - Math.floor(w / 2), L.horizon + 2 + k * 2, w, 1);
      }
      b.globalAlpha = 1;
    }
    // shimmer lines
    b.fillStyle = look.shimmer;
    for (const s of shimmers) {
      const v = Math.sin(t * s.sp + s.ph);
      if (v < 0.35) continue;
      b.globalAlpha = (0.25 + 0.5 * v) * (tod === "night" ? 0.7 : 1);
      const dx = Math.round(Math.sin(t * 0.4 + s.ph) * 2);
      b.fillRect(s.x + dx, s.y, s.len, 1);
    }
    b.globalAlpha = 1;

    // ---- birds (not at night)
    if (tod !== "night") {
      const period = 24;
      const cyc = Math.floor(t / period);
      const local = t - cyc * period;
      const dur = 11;
      if (local < dur) {
        const rnd = mulberry32(cyc * 977 + 3);
        const y0 = L.horizon * (0.22 + rnd() * 0.3);
        const dir = rnd() < 0.5 ? 1 : -1;
        const count = 1 + Math.floor(rnd() * 3);
        for (let k = 0; k < count; k++) {
          const p = clamp(local / dur - k * 0.03, 0, 1);
          if (p <= 0) continue;
          const x = dir > 0 ? -8 + p * (L.LW + 16) : L.LW + 8 - p * (L.LW + 16);
          const y = y0 + Math.sin(p * 9 + k) * 3 + k * 4;
          const frame = BIRD_FRAMES[Math.floor(t * 4 + k) % 2];
          b.fillStyle = tod === "day" ? "#2c3a52" : "#241e3c";
          frame.forEach((row, ry) => {
            for (let rx = 0; rx < row.length; rx++) if (row[rx] === "o") b.fillRect(Math.round(x) + rx, Math.round(y) + ry, 1, 1);
          });
        }
      }
    }

    // ---- dock + props
    b.drawImage(layers.props, 0, 0);
    // lantern glow
    if (tod === "night" || tod === "dusk") {
      const lx = Math.max(6, L.fx - 14);
      const ly = L.dockY - 7;
      const flick = 0.85 + 0.15 * Math.sin(t * 7) * Math.sin(t * 3.1);
      const base = tod === "night" ? 0.16 : 0.07;
      for (let k = 3; k >= 1; k--) {
        b.globalAlpha = base * flick * (4 - k) * 0.6;
        disc(b, lx, ly, 4 + k * 4, "#ffcf70");
      }
      b.globalAlpha = 1;
    }

    // ---- fisher
    const breathe = Math.sin(t * 1.2) > 0.9 ? 1 : 0;
    b.drawImage(layers.fisher, L.fx - 1, L.fy - 1 + breathe * 0);

    // ---- rod / line / bobber geometry
    const phase = state.phase;
    let tipX = L.tipX;
    let tipY = L.tipY;
    let dip = 0; // bobber submerge in px
    let bobOffset = 0;
    const catchJump = { active: false, x: 0, y: 0, vx: 0, vy: 0, u: 0 };
    const JUMP_START = 0.3;
    const JUMP_DUR = 1.25;
    const landX = L.bobX - 18;

    if (phase === "waiting") {
      bobOffset = Math.round(Math.sin(t * 2.1) * 0.8 + Math.sin(t * 0.7) * 0.4);
      tipY += Math.sin(t * 0.9) > 0.85 ? 1 : 0;
    } else if (phase === "bite") {
      if (pt < 1.3) {
        dip = Math.max(0, Math.round(1.6 + 1.6 * Math.sin(pt * 16)));
        tipY += Math.round(Math.max(0, Math.sin(pt * 16)) * 1.2);
      } else {
        dip = 4 + (Math.sin(pt * 22) > 0 ? 0 : 1);
        tipY += 2 + (Math.sin(pt * 22) > 0 ? 1 : 0);
        tipX -= 1;
      }
    } else {
      const raise = smooth(clamp(pt / 0.35, 0, 1));
      const settle = smooth(clamp((pt - 1.8) / 0.8, 0, 1));
      const k = raise * (1 - settle);
      tipX -= Math.round(5 * k);
      tipY -= Math.round(4 * k);
      const u = (pt - JUMP_START) / JUMP_DUR;
      if (u >= 0 && u <= 1) {
        const apex = 40;
        catchJump.active = true;
        catchJump.u = u;
        catchJump.x = L.bobX + (landX - L.bobX) * u;
        catchJump.y = L.bobY - apex * 4 * u * (1 - u) - 2;
        catchJump.vx = (landX - L.bobX) / JUMP_DUR;
        catchJump.vy = (-apex * 4 * (1 - 2 * u)) / JUMP_DUR;
      }
      if (pt < JUMP_START) dip = Math.round(3 * smooth(pt / JUMP_START));
      else if (pt > JUMP_START + JUMP_DUR) bobOffset = Math.round(Math.sin((pt - JUMP_START - JUMP_DUR) * 5) * Math.exp(-(pt - JUMP_START - JUMP_DUR) * 1.2) * 1.4);
    }

    // rod
    const hx = L.handX;
    const hy = L.handY;
    const rodC = tintColor("#8a5a2e", look);
    const rodD = tintColor("#5d3b1d", look);
    b.fillStyle = rodD;
    line(b, hx - 2, hy + 3, hx + 4, hy - 3, 2);
    // mid-curve for a bit of flex
    const midX = (hx + tipX) / 2 + (phase === "waiting" ? 0 : 1);
    const midY = (hy + tipY) / 2 + (phase === "waiting" ? 0 : -1 + (tipY - L.tipY) * 0.3);
    b.fillStyle = rodC;
    line(b, hx + 4, hy - 3, midX, midY, 1);
    line(b, midX, midY, tipX, tipY, 1);
    // reel
    b.fillStyle = tintColor("#b9c2cc", look);
    b.fillRect(hx + 1, hy - 1, 2, 2);

    // bobber position
    const bx = L.bobX;
    const waterY = L.bobY;
    const bobTop = waterY + bobOffset + dip;
    const hidden = catchJump.active;

    // line
    let endX = bx;
    let endY = bobTop - 5;
    if (hidden) {
      endX = Math.round(catchJump.x) + 2;
      endY = Math.round(catchJump.y);
    }
    const sag = hidden ? 2 : 3;
    b.fillStyle = withAlpha("#f2f6f8", 0.85);
    const cX = (tipX + endX) / 2 - 1;
    const cY = (tipY + endY) / 2 + sag;
    const dist = Math.hypot(endX - tipX, endY - tipY);
    const n = Math.max(6, Math.ceil(dist * 1.1));
    let lpx = NaN, lpy = NaN;
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const x = Math.round((1 - u) * (1 - u) * tipX + 2 * (1 - u) * u * cX + u * u * endX);
      const y = Math.round((1 - u) * (1 - u) * tipY + 2 * (1 - u) * u * cY + u * u * endY);
      if (x === lpx && y === lpy) continue;
      b.fillRect(x, y, 1, 1);
      lpx = x; lpy = y;
    }

    // ambient + bite ripples
    const rcol = look.shimmer;
    if (phase === "waiting") {
      const rp = (t % 3.4) / 3.4;
      ripple(b, bx, waterY + 1, 2 + rp * 9, rcol, (1 - rp) * 0.7);
      const rp2 = ((t + 1.7) % 3.4) / 3.4;
      ripple(b, bx, waterY + 1, 2 + rp2 * 9, rcol, (1 - rp2) * 0.5);
    } else if (phase === "bite") {
      const rp = (pt * 1.8) % 1;
      ripple(b, bx, waterY + 1, 2 + rp * 8, rcol, (1 - rp) * 0.9);
      const rp2 = (pt * 1.8 + 0.5) % 1;
      ripple(b, bx, waterY + 1, 2 + rp2 * 8, rcol, (1 - rp2) * 0.7);
      splash(bx, waterY, (pt * 3) % 1, 5 + Math.floor(pt * 3), "#ffffff", 5, 0.5);
    }

    // bobber
    if (!hidden) {
      const topY = bobTop - 5;
      const rows: [string, number][] = [["#ffffff", 0], ["#e8463c", 1], ["#e8463c", 2], ["#f6f6f2", 3]];
      for (const [col, r] of rows) {
        const y = topY + r + 1;
        if (y >= waterY + 1) continue;
        b.fillStyle = tintColor(col, look);
        if (r === 0) b.fillRect(bx, y, 1, 1);
        else b.fillRect(bx - 1, y, 3, 1);
      }
      if (topY + 5 <= waterY + 1) {
        b.globalAlpha = 0.45;
        b.fillStyle = "#ffffff";
        b.fillRect(bx - 1, topY + 5, 3, 1);
        b.globalAlpha = 1;
      }
    }

    // ---- "!" bubble on bite
    if (phase === "bite" && Math.floor(pt * 5) % 2 === 0) {
      const bc = bubbleCanvas();
      b.drawImage(bc, L.fx + 2, L.fy - 15 - (pt < 0.15 ? 2 : 0));
    }

    // ---- catch: jump, splash, sparkle
    if (phase === "catch") {
      splash(bx, waterY, pt - JUMP_START + 0.02, 21, splashColor, 16, 1);
      ripple(b, bx, waterY + 1, 2 + clamp(pt - JUMP_START, 0, 2) * 10, splashColor, clamp(1 - (pt - JUMP_START) / 1.6, 0, 1) * 0.8);
      const tLand = pt - (JUMP_START + JUMP_DUR);
      splash(landX, waterY, tLand, 77, splashColor, 14, 0.9);
      ripple(b, landX, waterY + 1, 2 + clamp(tLand, 0, 2) * 11, splashColor, tLand >= 0 ? clamp(1 - tLand / 1.6, 0, 1) * 0.9 : 0);
      ripple(b, landX, waterY + 1, 1 + clamp(tLand - 0.25, 0, 2) * 9, splashColor, tLand >= 0.25 ? clamp(1 - (tLand - 0.25) / 1.4, 0, 1) * 0.6 : 0);

      if (catchJump.active) {
        const goingLeft = catchJump.vx < 0;
        const ang = (Math.atan2(catchJump.vy, Math.abs(catchJump.vx)) * 180) / Math.PI;
        let idx = 0;
        let bestD = 1e9;
        JUMP_ANGLES.forEach((a, i) => {
          const d = Math.abs(a - ang);
          if (d < bestD) { bestD = d; idx = i; }
        });
        const fc = jumpCanvas(rarity, idx);
        const glow = rarity === "legendary" ? 0.3 : rarity === "epic" ? 0.24 : rarity === "rare" ? 0.18 : 0;
        if (glow > 0) {
          b.globalAlpha = glow;
          disc(b, catchJump.x, catchJump.y, 12, rarityColor);
          b.globalAlpha = glow * 0.8;
          disc(b, catchJump.x, catchJump.y, 8, "#ffffff");
          b.globalAlpha = 1;
        }
        b.save();
        b.translate(Math.round(catchJump.x), Math.round(catchJump.y));
        if (goingLeft) b.scale(-1, 1);
        b.drawImage(fc, -11, -11);
        b.restore();
        // sparkle trail for rare+
        if (rarity !== "common" && rarity !== "uncommon") {
          const rnd = mulberry32(1234);
          for (let k = 1; k <= 8; k++) {
            const uu = catchJump.u - k * 0.035;
            if (uu < 0) break;
            const sx = L.bobX + (landX - L.bobX) * uu + (rnd() - 0.5) * 8;
            const sy = L.bobY - 40 * 4 * uu * (1 - uu) - 2 + (rnd() - 0.5) * 8;
            b.globalAlpha = (1 - k / 9) * (0.5 + 0.5 * Math.sin(t * 20 + k));
            b.fillStyle = k % 2 ? rarityColor : "#ffffff";
            b.fillRect(Math.round(sx), Math.round(sy), 1, 1);
            if (k % 3 === 0) { b.fillRect(Math.round(sx) - 1, Math.round(sy), 3, 1); b.fillRect(Math.round(sx), Math.round(sy) - 1, 1, 3); }
          }
          b.globalAlpha = 1;
        }
      }
    }

    // ---- fireflies
    if (tod === "night") {
      for (let i = 0; i < 9; i++) {
        const fxp = L.LW * (0.08 + 0.1 * i) + Math.sin(t * 0.35 + i * 2.1) * 9 + Math.sin(t * 0.8 + i) * 3;
        const fyp = L.horizon + (L.dockY - L.horizon) * (0.25 + 0.6 * ((i * 37) % 10) / 10) + Math.sin(t * 0.5 + i * 1.3) * 6;
        const pulse = 0.5 + 0.5 * Math.sin(t * 1.4 + i * 2.3);
        if (pulse < 0.15) continue;
        b.globalAlpha = 0.14 * pulse;
        b.fillStyle = "#d8ff7a";
        b.fillRect(Math.round(fxp) - 1, Math.round(fyp) - 1, 3, 3);
        b.globalAlpha = 0.4 + 0.6 * pulse;
        b.fillRect(Math.round(fxp), Math.round(fyp), 1, 1);
      }
      b.globalAlpha = 1;
    }

    // ---- composite to the visible canvas
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = look.sky[0];
    ctx.fillRect(0, 0, L.cw, L.ch);
    if (L.offY > 0) {
      ctx.fillStyle = look.water[look.water.length - 1];
      ctx.fillRect(0, L.offY + L.LH * L.S, L.cw, L.ch - (L.offY + L.LH * L.S));
    }
    ctx.drawImage(buffer, 0, 0, L.LW, L.LH, L.offX, L.offY, L.LW * L.S, L.LH * L.S);
  }

  function destroy(): void {
    destroyed = true;
    layerCache.clear();
  }

  // initial sizing from the canvas' current CSS size when available
  const rect = typeof canvas.getBoundingClientRect === "function" ? canvas.getBoundingClientRect() : null;
  if (rect && rect.width > 0 && rect.height > 0) {
    resize(rect.width, rect.height, (typeof window !== "undefined" && window.devicePixelRatio) || 1);
  }

  return { render, resize, destroy };
}
