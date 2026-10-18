import { type ParsedSprite, type SpriteMap, getCachedCanvas, getCachedDataUrl, parseSprite } from "./sprite";

export const ICON_SIZE = 12;

export type IconName =
  | "coin"
  | "rod"
  | "line"
  | "bait"
  | "backpack"
  | "book"
  | "gear"
  | "lake"
  | "music-on"
  | "music-off"
  | "star";


/** 12x12 pixel icon maps. '.' = transparent. */
export const ICON_MAPS: Record<IconName, SpriteMap> = {
  coin: {
    rows: [
      "...oooooo...",
      "..oYYyyyyo..",
      ".oYYyyyyyyo.",
      "oYYyyddyyydo",
      "oYyyyddyyydo",
      "oYyyyddyyydo",
      "oyyyyddyyydo",
      "oyyyyddyyydo",
      "oyyyyddyyddo",
      ".oyyyyyyddo.",
      "..oddddddo..",
      "...oooooo..."
    ],
    palette: { o: "#7a4a1a", Y: "#fff0a0", y: "#f6c32c", d: "#d9951c" }
  },
  rod: {
    rows: [
      ".........rr.",
      "........rr.l",
      ".......rr..l",
      "......rr...l",
      ".....rr....l",
      "....rr.....l",
      "...rr......l",
      "..hmr......l",
      ".hhmm.....RR",
      "hh........RR",
      "h.........ww",
      "..........ww"
    ],
    palette: { r: "#a8743a", h: "#6b4423", m: "#b9c2cc", l: "#9fb4c4", R: "#e8463c", w: "#f4f4f4" }
  },
  line: {
    rows: [
      ".....l......",
      ".....l......",
      ".....l......",
      "....oMo.....",
      ".....M......",
      ".....M....M.",
      ".....M....MM",
      ".....M....M.",
      ".....MM..MM.",
      "......MMMM..",
      "............",
      "............"
    ],
    palette: { o: "#6b7a8c", l: "#7fb8d8", M: "#9fb0c4" }
  },
  bait: {
    rows: [
      "............",
      "............",
      "...oooo.....",
      "..oPPPPo....",
      ".oPpPPpPo...",
      ".oPPooPPPo..",
      "..oo.oPpPo..",
      "......oPPPo.",
      "..oo.oPPpPo.",
      ".oPPoPPPPo..",
      ".oPPPPpPo...",
      "..oooooo...."
    ],
    palette: { o: "#7a2f4a", P: "#f08aa8", p: "#d65f86" }
  },
  backpack: {
    rows: [
      "....oooo....",
      "...oBBBBo...",
      "..oBbbbbBo..",
      "..oBBBBBBo..",
      ".oBBBBBBBBo.",
      ".oBBoooooBBo",
      ".oBBoYYYoBBo",
      ".oBBoooooBBo",
      ".oBBBBBBBBo.",
      ".oBBBBBBBBo.",
      ".odBBBBBBdo.",
      "..oooooooo.."
    ],
    palette: { o: "#4a2d1a", B: "#c76a3a", b: "#e58a54", d: "#9a4a28", Y: "#f6c32c" }
  },
  book: {
    rows: [
      "............",
      ".ooooooooo..",
      ".oBBBBBBBBo.",
      ".oBbbbbbbBo.",
      ".oBbWWWWbBo.",
      ".oBbbbbbbBo.",
      ".oBbWWWbbBo.",
      ".oBbbbbbbBo.",
      ".oBBBBBBBBo.",
      ".oPPPPPPPPo.",
      ".oooooooooo.",
      "............"
    ],
    palette: { o: "#23304a", B: "#3f6fb5", b: "#5a8fd8", W: "#f4e8c0", P: "#f4ead0" }
  },
  gear: {
    rows: [
      ".....oo.....",
      ".oo.oggo.oo.",
      ".oggggggggo.",
      "oggggggggggo",
      "ogggoooogggo",
      "ogggoooogggo",
      "ogggoooogggo",
      "ogggoooogggo",
      "oggggggggggo",
      ".oggggggggo.",
      ".oo.oggo.oo.",
      ".....oo....."
    ],
    palette: { o: "#3b4150", g: "#aab5c4" }
  },
  lake: {
    rows: [
      "............",
      "........yy..",
      ".......yyyy.",
      "...m...yyyy.",
      "..mmm...yy..",
      ".mmmmm.mm...",
      "mmmmmmmmmm..",
      "bbbbbbbbbbbb",
      "bwwbbbbwwbbb",
      "bbbbwwbbbbbb",
      "bbbbbbbbwwbb",
      "dddddddddddd"
    ],
    palette: { y: "#ffd84a", m: "#6a7fa8", b: "#4aa3d8", w: "#bfe6f8", d: "#2f7fb4" }
  },
  "music-on": {
    rows: [
      "....oooooo..",
      "....oNNNNo.s",
      "....oNoooo.s",
      "....oNo..s.s",
      "....oNo.s.s.",
      "....oNo..s..",
      "....oNo.....",
      "..ooNNo.....",
      ".oNNNNo.....",
      ".oNNNNo.....",
      "..oNNo......",
      "............"
    ],
    palette: { o: "#2a5a48", N: "#5fd3a4", s: "#a9ecd0" }
  },
  "music-off": {
    rows: [
      "....oooooo..",
      "....oNNNNo..",
      "....oNoooo..",
      "....oNo.....",
      "....oNo.....",
      "....oNo.....",
      "....oNo.....",
      "..ooNNox...x",
      ".oNNNNo.x.x.",
      ".oNNNNo..x..",
      "..oNNo..x.x.",
      ".......x...x"
    ],
    palette: { o: "#4a4f5c", N: "#8a93a3", x: "#e8584a" }
  },
  star: {
    rows: [
      ".....oo.....",
      "....oyyo....",
      "....oyYo....",
      "ooooyYyyoooo",
      "oyyyyYyyyyyo",
      ".oyyyyyyyyo.",
      "..oyyyyyyo..",
      "..oyyyyyyo..",
      ".oyyyooyyyo.",
      ".oyyoo.ooyyo",
      ".oyo....oyo.",
      ".oo......oo."
    ],
    palette: { o: "#9a6a10", y: "#ffc93a", Y: "#fff2a8" }
  }
};

export const ICON_NAMES = Object.keys(ICON_MAPS) as IconName[];

function iconParsed(name: IconName): ParsedSprite {
  const map = ICON_MAPS[name];
  if (!map) throw new Error(`Unknown icon ${String(name)}`);
  return parseSprite(map);
}

/** Cached 12x12 (x scale) icon canvas. */
export function getIconCanvas(name: IconName, scale: number): HTMLCanvasElement {
  return getCachedCanvas(`icon:${name}`, scale, () => iconParsed(name));
}

/** Cached PNG data URL of a pixel icon for `<img src>`. Use `image-rendering: pixelated`. */
export function getIconDataUrl(name: IconName, scale: number): string {
  return getCachedDataUrl(`icon:${name}`, scale, () => iconParsed(name));
}

/** Draw an icon with its top-left at x,y (integer scale). */
export function drawIcon(ctx: CanvasRenderingContext2D, name: IconName, x: number, y: number, scale: number): void {
  const prev = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(getIconCanvas(name, scale), Math.round(x), Math.round(y));
  ctx.imageSmoothingEnabled = prev;
}
