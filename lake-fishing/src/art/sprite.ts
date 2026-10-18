/**
 * Pixel sprite format: rows of characters + a palette (char -> CSS color).
 * '.' is always transparent. Everything is rendered once to an offscreen
 * canvas at an integer scale and cached.
 */

export type Palette = Record<string, string>;

export interface SpriteMap {
  /** Equal-length rows. '.' = transparent. */
  rows: string[];
  palette: Palette;
}

export interface ParsedSprite {
  width: number;
  height: number;
  /** Row-major CSS colors, null = transparent. */
  pixels: (string | null)[];
}

/** Return a list of problems with a sprite map (empty list = valid). Pure, no DOM. */
export function validateSpriteMap(map: SpriteMap): string[] {
  const problems: string[] = [];
  if (map.rows.length === 0) problems.push("no rows");
  const w = map.rows[0]?.length ?? 0;
  map.rows.forEach((row, y) => {
    if (row.length !== w) problems.push(`row ${y} has width ${row.length}, expected ${w}`);
    for (const ch of row) {
      if (ch !== "." && !(ch in map.palette)) problems.push(`row ${y}: char '${ch}' not in palette`);
    }
  });
  if ("." in map.palette) problems.push("'.' must not be in palette");
  return problems;
}

/** Parse a sprite map into a color grid. Throws if the map is invalid. */
export function parseSprite(map: SpriteMap): ParsedSprite {
  const problems = validateSpriteMap(map);
  if (problems.length) throw new Error("Invalid sprite: " + problems.join("; "));
  const width = map.rows[0].length;
  const height = map.rows.length;
  const pixels: (string | null)[] = [];
  for (const row of map.rows) for (const ch of row) pixels.push(ch === "." ? null : map.palette[ch]);
  return { width, height, pixels };
}

/** Build a sprite map from a color grid (used by procedural builders). */
export function gridToMap(grid: string[][], palette: Palette): SpriteMap {
  return { rows: grid.map((r) => r.join("")), palette };
}

export function createCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.floor(w));
  c.height = Math.max(1, Math.floor(h));
  return c;
}

export function get2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable");
  ctx.imageSmoothingEnabled = false;
  return ctx;
}

/** Paint a parsed sprite into a context at integer scale (no caching). */
export function paintSprite(ctx: CanvasRenderingContext2D, sprite: ParsedSprite, x = 0, y = 0, scale = 1): void {
  const s = Math.max(1, Math.round(scale));
  let last: string | null = null;
  for (let j = 0; j < sprite.height; j++) {
    for (let i = 0; i < sprite.width; i++) {
      const c = sprite.pixels[j * sprite.width + i];
      if (!c) continue;
      if (c !== last) {
        ctx.fillStyle = c;
        last = c;
      }
      ctx.fillRect(x + i * s, y + j * s, s, s);
    }
  }
}

/** Render a parsed sprite to a fresh canvas at integer scale. */
export function renderSprite(sprite: ParsedSprite, scale = 1): HTMLCanvasElement {
  const s = Math.max(1, Math.round(scale));
  const canvas = createCanvas(sprite.width * s, sprite.height * s);
  paintSprite(get2d(canvas), sprite, 0, 0, s);
  return canvas;
}

const canvasCache = new Map<string, HTMLCanvasElement>();
const urlCache = new Map<string, string>();

/** Cached render. `key` must uniquely identify the sprite content. */
export function getCachedCanvas(key: string, scale: number, build: () => ParsedSprite): HTMLCanvasElement {
  const s = Math.max(1, Math.round(scale));
  const k = `${key}@${s}`;
  let c = canvasCache.get(k);
  if (!c) {
    c = renderSprite(build(), s);
    canvasCache.set(k, c);
  }
  return c;
}

/** Cached data URL for a sprite. */
export function getCachedDataUrl(key: string, scale: number, build: () => ParsedSprite): string {
  const s = Math.max(1, Math.round(scale));
  const k = `${key}@${s}`;
  let u = urlCache.get(k);
  if (!u) {
    u = getCachedCanvas(key, s, build).toDataURL("image/png");
    urlCache.set(k, u);
  }
  return u;
}

/** Rotate a color grid by `angle` radians around its center (nearest neighbour). */
export function rotateSprite(sprite: ParsedSprite, angle: number): ParsedSprite {
  const { width: w, height: h } = sprite;
  const cos = Math.cos(-angle);
  const sin = Math.sin(-angle);
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;
  const out: (string | null)[] = new Array(w * h).fill(null);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const sx = Math.round(dx * cos - dy * sin + cx);
      const sy = Math.round(dx * sin + dy * cos + cy);
      if (sx >= 0 && sx < w && sy >= 0 && sy < h) out[y * w + x] = sprite.pixels[sy * w + sx];
    }
  }
  return { width: w, height: h, pixels: out };
}
