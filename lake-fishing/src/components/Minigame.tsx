import { useEffect, useRef, useState } from "react";
import { RARITY_COLORS } from "../art";
import { getFishById } from "../data/fish";
import { createMinigameState, getMinigameTimeFraction, stepMinigame } from "../services";
import type { MinigameState } from "../services";
import type { SfxName } from "../game/audio";
import { formatCountdown } from "../game/format";
import { FishSprite } from "./Pixel";

interface Props {
  fishId: string;
  reducedMotion: boolean;
  onFinish: (success: boolean) => void;
  playSfx: (name: SfxName) => void;
}

/** Longest frame we simulate; a longer gap (tab switch, debugger) just pauses the round. */
const MAX_FRAME_MS = 250;
const RESULT_HOLD_MS = 1000;

export function Minigame({ fishId, reducedMotion, onFinish, playSfx }: Props) {
  const [mg, setMg] = useState<MinigameState>(() => createMinigameState());
  const [holding, setHolding] = useState(false);
  const holdRef = useRef(false);
  const pointers = useRef(new Set<number>());
  const spaceDown = useRef(false);
  const finishedRef = useRef(false);
  const mgRef = useRef(mg);

  const syncHolding = () => {
    const next = pointers.current.size > 0 || spaceDown.current;
    holdRef.current = next;
    setHolding(next);
  };

  // Round loop.
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let wasInZone = true;
    const frame = (t: number) => {
      const dt = t - last;
      last = t;
      const current = mgRef.current;
      if (current.status === "playing") {
        const next = stepMinigame(current, dt > MAX_FRAME_MS ? 0 : dt, holdRef.current);
        if (next !== current) {
          mgRef.current = next;
          setMg(next);
          if (next.inZone && !wasInZone) playSfx("minigame-tick");
          wasInZone = next.inZone;
        }
      } else if (!finishedRef.current) {
        finishedRef.current = true;
        const success = current.status === "success";
        playSfx(success ? "minigame-success" : "minigame-fail");
        window.setTimeout(() => onFinish(success), RESULT_HOLD_MS);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
    // onFinish / playSfx are stable store wrappers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Space key + release on blur / hide.
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.code === "Space") {
        event.preventDefault();
        spaceDown.current = true;
        syncHolding();
      }
    };
    const up = (event: KeyboardEvent) => {
      if (event.code === "Space") {
        spaceDown.current = false;
        syncHolding();
      }
    };
    const release = () => {
      spaceDown.current = false;
      pointers.current.clear();
      syncHolding();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", release);
    document.addEventListener("visibilitychange", release);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", release);
      document.removeEventListener("visibilitychange", release);
    };
  }, []);

  const fish = getFishById(fishId);
  const done = mg.status !== "playing";
  const timeLeft = mg.config.timeLimitMs - mg.elapsedMs;
  const zoneBottom = (mg.zoneCenter - mg.zoneHalfWidth) * 100;
  const zoneHeight = mg.zoneHalfWidth * 2 * 100;

  const press = (event: React.PointerEvent) => {
    if ((event.target as HTMLElement).closest("button")) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    pointers.current.add(event.pointerId);
    syncHolding();
  };
  const lift = (event: React.PointerEvent) => {
    pointers.current.delete(event.pointerId);
    syncHolding();
  };

  return (
    <div
      className={`minigame ${holding ? "holding" : ""} ${mg.inZone ? "in-zone" : ""} ${done ? `done-${mg.status}` : ""}`}
      onPointerDown={press}
      onPointerUp={lift}
      onPointerCancel={lift}
      onLostPointerCapture={lift}
      onContextMenu={(event) => event.preventDefault()}
    >
      <header className="mg-head">
        <h2>收線！</h2>
        <span className="mg-timer" aria-label="剩餘時間">
          {formatCountdown(Math.max(0, timeLeft))}
        </span>
      </header>

      <div className="mg-time bar bar-thin" aria-hidden="true">
        <div className="bar-fill bar-warn" style={{ width: `${(1 - getMinigameTimeFraction(mg)) * 100}%` }} />
      </div>

      <div className="mg-stage">
        <div
          className="mg-bar px-panel"
          role="progressbar"
          aria-label="張力"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(mg.indicator * 100)}
        >
          <span className="mg-end mg-end-top">緊</span>
          <span className="mg-end mg-end-bottom">鬆</span>
          <div className="mg-danger" />
          <div className="mg-zone" style={{ bottom: `${zoneBottom}%`, height: `${zoneHeight}%` }} />
          <div className="mg-marker" style={{ bottom: `${mg.indicator * 100}%` }} />
        </div>
        <div className="mg-fish" style={{ bottom: `${mg.indicator * 100}%`, ["--rc" as string]: RARITY_COLORS[fish?.rarity ?? "rare"] }}>
          <FishSprite fishId={fishId} px={3} silhouette={!done || mg.status === "fail"} silhouetteColor="#47719f" className={reducedMotion ? "" : "mg-fish-img"} />
        </div>
      </div>

      <div className="mg-progress">
        <div className="mg-progress-label">
          <span>捕獲進度</span>
          <span>{Math.round(mg.progress * 100)}%</span>
        </div>
        <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(mg.progress * 100)}>
          <div className="bar-fill bar-good" style={{ width: `${mg.progress * 100}%` }} />
        </div>
      </div>

      <div className="mg-hint px-panel" aria-live="polite">
        {done
          ? mg.status === "success"
            ? "成功！完美收線 ★"
            : "魚溜走了…不過沒關係，會把牠收進背包"
          : mg.inZone
            ? "很好！穩住～"
            : holding
              ? "按住中：張力上升"
              : "按住畫面拉線，放開放線（空白鍵也可以）"}
      </div>

      <button className="btn mg-quit" data-sfx="none" disabled={done} onClick={() => !finishedRef.current && onFinish(false)}>
        放棄
      </button>
    </div>
  );
}
