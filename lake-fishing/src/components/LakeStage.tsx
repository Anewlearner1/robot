import { useEffect, useRef } from "react";
import type { PointerEvent } from "react";
import { getCollectionProgress, getFishingIntervalSeconds } from "../services";
import { TAP_LABEL, formatCoins, formatCountdown } from "../game/format";
import type { GameState } from "../game/state";
import { timerFraction } from "../game/timer";
import { LakeCanvas } from "./LakeCanvas";
import { Icon } from "./Pixel";
import { TimingBar } from "./TimingBar";

interface Props {
  state: GameState;
  reducedMotion: boolean;
  onTap: () => void;
  getRoundElapsed: () => number;
  onToggleMusic: () => void;
}

/** Space taps unless the player is typing or has focused a button that Space would activate. */
function spaceShouldTap(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return true;
  if (target.closest("input, textarea, select, [contenteditable='true'], a")) return false;
  const button = target.closest("button");
  return !button || !!button.closest(".tabbar, .lake-view");
}

/**
 * The left column on wide screens, the top of the lake tab on phones: coins, encyclopedia progress,
 * the lake scene with the bobber-timing bar overlaid, and the countdown. Never blocks anything:
 * tapping the lake (or Space) is optional and the countdown never pauses.
 */
export function LakeStage({ state, reducedMotion, onTap, getRoundElapsed, onToggleMusic }: Props) {
  const { save, round, tapFeedback, log } = state;
  const progress = getCollectionProgress(save.discoveredFishIds);
  const intervalMs = getFishingIntervalSeconds(save.equipmentLevels.rod) * 1000;
  const fraction = timerFraction(state.progressMs, intervalMs);
  const phase = state.catchFx ? "catch" : round && !reducedMotion ? "bite" : "waiting";
  const latest = log[0];
  const gain = latest ? latest.saleCoins + latest.bonusCoins : 0;
  const musicOn = save.settings.musicEnabled;
  const tapped = round?.tap != null;

  const tapRef = useRef(onTap);
  tapRef.current = onTap;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.repeat || !spaceShouldTap(event.target)) return;
      event.preventDefault();
      tapRef.current();
    };
    // A focused button would otherwise be activated when Space is released.
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space" && spaceShouldTap(event.target)) event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (event.target instanceof Element && event.target.closest("button")) return;
    onTap();
  };

  return (
    <section className="stage" aria-label="湖畔">
      <div className={`lake-view ${round ? "is-bite" : ""}`} onPointerDown={onPointerDown} data-testid="lake-view">
        <LakeCanvas phase={phase} rarity={state.catchFx?.rarity} reducedMotion={reducedMotion} />
        <div className="hud">
          <div className="hud-left">
            <div className="coin-counter px-panel" aria-label={`金幣 ${save.coins}`}>
              <Icon name="coin" px={2} />
              <span className="coin-value">{formatCoins(save.coins)}</span>
              {state.catchFx && latest && gain > 0 && (
                <span className="coin-float" key={latest.id}>
                  +{formatCoins(gain)}
                </span>
              )}
            </div>
            <div className="dex-chip px-panel" data-testid="dex-progress">
              <Icon name="book" px={1} />
              圖鑑 {progress.discovered}/{progress.total}（{progress.percent}%）
            </div>
          </div>
          <div className="hud-right">
            {!state.saveOk && (
              <span className="warn-chip px-panel" role="alert">
                無法儲存
              </span>
            )}
            <button
              className="icon-btn px-panel"
              data-sfx="none"
              aria-label={musicOn ? "關閉背景音樂" : "開啟背景音樂"}
              aria-pressed={musicOn}
              onClick={onToggleMusic}
            >
              <Icon name={musicOn ? "music-on" : "music-off"} px={2} />
            </button>
          </div>
        </div>

        {tapFeedback && (
          <div
            className={`tap-feedback is-${tapFeedback.result}`}
            key={tapFeedback.id}
            role="status"
            data-testid="tap-feedback"
          >
            {TAP_LABEL[tapFeedback.result]}
          </div>
        )}
        {round && <TimingBar round={round} getElapsed={getRoundElapsed} />}
        <p className="sr-only" aria-live="assertive">
          {round && !tapped ? "咬鉤了！點擊湖面或按空白鍵" : ""}
        </p>
      </div>

      <div className="countdown px-panel">
        <div className="next-row">
          <span className="next-label">{round ? (tapped ? "已出手，等待收線" : "咬鉤了！") : "下一隻"}</span>
          <span className="next-time">{formatCountdown(intervalMs - state.progressMs)}</span>
        </div>
        <div
          className="bar"
          role="progressbar"
          aria-label="下一隻倒數"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(fraction * 100)}
        >
          <div className={`bar-fill ${round ? "bar-warn" : ""}`} style={{ width: `${fraction * 100}%` }} />
        </div>
      </div>
    </section>
  );
}
