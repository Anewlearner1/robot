import { useEffect, useRef } from "react";
import { createLakeScene, getTimeOfDay } from "../art";
import type { FishRarity } from "../services";
import type { ScenePhase } from "../art";

interface Props {
  phase: ScenePhase;
  rarity?: FishRarity;
  reducedMotion: boolean;
}

/** The pixel lake scene, sized to its container and redrawn every animation frame. */
export function LakeCanvas({ phase, rarity, reducedMotion }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const live = useRef({ phase, rarity, reducedMotion });
  live.current = { phase, rarity, reducedMotion };

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const scene = createLakeScene(canvas);
    const resize = () => {
      const { width, height } = wrap.getBoundingClientRect();
      if (width > 0 && height > 0) scene.resize(Math.floor(width), Math.floor(height), window.devicePixelRatio || 1);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(wrap);

    let raf = 0;
    let lastDraw = -Infinity;
    const frame = (t: number) => {
      const { phase: p, rarity: r, reducedMotion: reduced } = live.current;
      // Reduced motion: a calm 2 fps scene instead of 60 fps ripples and jumps.
      if (!reduced || t - lastDraw >= 500) {
        lastDraw = t;
        scene.render({ timeOfDay: getTimeOfDay(new Date()), phase: p, catchRarity: r }, t);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      scene.destroy();
    };
  }, []);

  return (
    <div className="lake-canvas" ref={wrapRef}>
      <canvas ref={canvasRef} aria-label="湖畔場景" role="img" />
    </div>
  );
}
