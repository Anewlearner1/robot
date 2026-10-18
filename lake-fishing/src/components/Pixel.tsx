import { getFishSpriteDataUrl, getIconDataUrl, ICON_SIZE, FISH_SPRITE_HEIGHT, FISH_SPRITE_WIDTH } from "../art";
import type { IconName } from "../art";

const dpr = () => (typeof window === "undefined" ? 1 : Math.max(1, window.devicePixelRatio || 1));

/** Pixel icon; `px` = CSS pixels per art pixel (the bitmap is rendered at an integer device scale). */
export function Icon({ name, px = 2, className }: { name: IconName; px?: number; className?: string }) {
  const ratio = dpr();
  const scale = Math.max(1, Math.round(px * ratio));
  const size = (ICON_SIZE * scale) / ratio; // whole device pixels per art pixel: always crisp
  return (
    <img
      className={`pix ${className ?? ""}`}
      src={getIconDataUrl(name, scale)}
      width={size}
      height={size}
      alt=""
      draggable={false}
      aria-hidden="true"
    />
  );
}

export function FishSprite({
  fishId,
  px = 2,
  silhouette = false,
  silhouetteColor,
  className,
  label
}: {
  fishId: string;
  px?: number;
  silhouette?: boolean;
  silhouetteColor?: string;
  className?: string;
  label?: string;
}) {
  const ratio = dpr();
  const scale = Math.max(1, Math.round(px * ratio));
  return (
    <img
      className={`pix ${className ?? ""}`}
      src={getFishSpriteDataUrl(fishId, scale, { silhouette, silhouetteColor })}
      width={(FISH_SPRITE_WIDTH * scale) / ratio}
      height={(FISH_SPRITE_HEIGHT * scale) / ratio}
      alt={label ?? ""}
      draggable={false}
      aria-hidden={label ? undefined : true}
    />
  );
}
