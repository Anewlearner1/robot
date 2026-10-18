/**
 * Pixel-art module for the lake-fishing game. Everything is drawn in code
 * (no images/fonts/network) and has no React dependency.
 *
 * - `createLakeScene(canvas)`  animated lake scene renderer
 * - `getFishSpriteDataUrl` / `drawFish`  25 fish sprites (+ silhouettes)
 * - `getIconDataUrl` / `drawIcon`  12x12 pixel UI icons
 * - `RARITY_COLORS`, `getTimeOfDay`
 */

/** Animated pixel lake scene: `{ render(state, nowMs), resize(cssW, cssH, dpr), destroy() }`. */
export { createLakeScene } from "./scene";
export type { LakeScene, SceneState, ScenePhase } from "./scene";

/** Fish sprites (32x16 px at scale 1, keyed by fish id incl. `fish_xenocypris`). */
export {
  FISH_SPRITE_HEIGHT,
  FISH_SPRITE_IDS,
  FISH_SPRITE_WIDTH,
  drawFish,
  getFishCanvas,
  getFishSpriteDataUrl,
  getFishSpriteMap,
  hasFishSprite
} from "./fishSprites";
export type { FishSpriteOptions } from "./fishSprites";

/** Pixel UI icons (12x12 px at scale 1). */
export { ICON_NAMES, ICON_SIZE, drawIcon, getIconCanvas, getIconDataUrl } from "./icons";
export type { IconName } from "./icons";

/** Rarity accent colors (common greyish-white, uncommon green, rare blue, epic purple, legendary gold). */
export { RARITY_COLORS } from "./palette";

/** Local time of day: dawn 5-7, day 7-17, dusk 17-19, night otherwise. */
export { getTimeOfDay } from "./time";
export type { TimeOfDay } from "./time";

/** Low-level sprite format helpers (string pixel maps + palette). */
export { parseSprite, validateSpriteMap } from "./sprite";
export type { Palette, ParsedSprite, SpriteMap } from "./sprite";
