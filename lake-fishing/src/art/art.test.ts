import { describe, expect, it } from "vitest";
import { FISH } from "../data/fish";
import { ICON_MAPS, ICON_NAMES } from "./icons";
import { FISH_SPRITE_HEIGHT, FISH_SPRITE_IDS, FISH_SPRITE_WIDTH, getFishSpriteMap, hasFishSprite, toSilhouetteMap } from "./fishSprites";
import { RARITY_COLORS } from "./palette";
import { getTimeOfDay } from "./time";
import { parseSprite, validateSpriteMap } from "./sprite";

describe("sprite maps", () => {
  it("every fish sprite has equal-width rows and only palette chars", () => {
    for (const id of FISH_SPRITE_IDS) {
      const map = getFishSpriteMap(id);
      expect(validateSpriteMap(map), id).toEqual([]);
      expect(map.rows.length, id).toBe(FISH_SPRITE_HEIGHT);
      expect(map.rows[0].length, id).toBe(FISH_SPRITE_WIDTH);
      const parsed = parseSprite(map);
      expect(parsed.pixels.some((p) => p !== null), id).toBe(true);
    }
  });

  it("has exactly 25 sprites, keyed by the renamed id", () => {
    expect(FISH_SPRITE_IDS).toHaveLength(25);
    expect(FISH_SPRITE_IDS).toContain("fish_xenocypris");
    expect(FISH_SPRITE_IDS).not.toContain("fish_cultrure");
  });

  it("every fish in src/data/fish.ts has a sprite", () => {
    for (const fish of FISH) {
      // fish_cultrure is being renamed to fish_xenocypris; both resolve to the same sprite.
      expect(hasFishSprite(fish.id), fish.id).toBe(true);
    }
    expect(hasFishSprite("fish_xenocypris")).toBe(true);
    expect(hasFishSprite("fish_nope")).toBe(false);
  });

  it("silhouettes are a single color and keep the shape", () => {
    for (const id of FISH_SPRITE_IDS) {
      const base = getFishSpriteMap(id);
      const sil = toSilhouetteMap(base);
      expect(validateSpriteMap(sil)).toEqual([]);
      expect(Object.keys(sil.palette)).toHaveLength(1);
      expect(sil.rows.length).toBe(base.rows.length);
    }
  });

  it("epic and legendary fish have glow/sparkle pixels, commons do not", () => {
    const has = (id: string) => getFishSpriteMap(id).rows.join("").match(/[HX]/) !== null;
    expect(has("fish_lake_guardian")).toBe(true);
    expect(has("fish_moonlight_carp")).toBe(true);
    expect(has("fish_carp")).toBe(false);
  });

  it("icons are valid 12x12 maps", () => {
    expect(ICON_NAMES.length).toBeGreaterThanOrEqual(11);
    for (const name of ICON_NAMES) {
      const m = ICON_MAPS[name];
      expect(validateSpriteMap(m), name).toEqual([]);
      expect(m.rows.length, name).toBe(12);
      expect(m.rows[0].length, name).toBe(12);
    }
  });

  it("rarity colors cover all rarities", () => {
    expect(Object.keys(RARITY_COLORS).sort()).toEqual(["common", "epic", "legendary", "rare", "uncommon"]);
  });
});

describe("getTimeOfDay", () => {
  const at = (h: number) => getTimeOfDay(new Date(2026, 0, 1, h, 0, 0));
  it("maps hours to time of day", () => {
    expect(at(4)).toBe("night");
    expect(at(5)).toBe("dawn");
    expect(at(6)).toBe("dawn");
    expect(at(7)).toBe("day");
    expect(at(16)).toBe("day");
    expect(at(17)).toBe("dusk");
    expect(at(18)).toBe("dusk");
    expect(at(19)).toBe("night");
    expect(at(0)).toBe("night");
    expect(at(23)).toBe("night");
  });
});
