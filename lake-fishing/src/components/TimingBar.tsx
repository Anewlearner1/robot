import { useEffect, useRef } from "react";
import { getRoundProgress, indicatorPosition } from "../services";
import type { TimingRound } from "../services";

interface Props {
  round: TimingRound;
  /** Milliseconds elapsed in the round right now (the one time base shared with the tap evaluation). */
  getElapsed: () => number;
}

const pct = (fraction: number) => `${fraction * 100}%`;

/**
 * The bobber-timing bar (PRD §9) overlaid on the lake: a sweeping indicator, the timing zone and the
 * narrower perfect zone. It is only a view of the service's round: positions come from `round`
 * and `indicatorPosition`. It never takes pointer events, so the whole lake stays tappable.
 * The indicator keeps moving with reduced motion on: it is the game itself, not decoration.
 */
export function TimingBar({ round, getElapsed }: Props) {
  const markerRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const marker = markerRef.current;
    const fill = fillRef.current;
    if (!marker || !fill) return;
    const place = (elapsedMs: number) => {
      marker.style.left = pct(indicatorPosition(round, elapsedMs));
      fill.style.width = pct(getRoundProgress(round, elapsedMs));
    };
    if (round.tap) {
      // The one tap was used: freeze the indicator where it landed.
      place(round.tap.elapsedMs);
      return;
    }
    let raf = 0;
    const frame = () => {
      place(getElapsed());
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [round, getElapsed]);

  const used = round.tap !== null;
  return (
    <div className={`timing ${used ? "is-used" : ""}`} role="group" aria-label="咬鉤時機條" data-testid="timing-bar">
      <div className="timing-head">
        <span className="timing-title">{used ? "已出手" : "咬鉤時機"}</span>
        <span className="timing-hint">{used ? "等待收線…" : "點擊湖面或按空白鍵"}</span>
      </div>
      <div className="timing-track">
        <div className="timing-zone" style={{ left: pct(round.zoneStart), width: pct(round.zoneEnd - round.zoneStart) }} />
        <div
          className="timing-perfect"
          style={{ left: pct(round.perfectStart), width: pct(round.perfectEnd - round.perfectStart) }}
        />
        <div className="timing-marker" ref={markerRef} />
      </div>
      <div className="timing-left" aria-hidden="true">
        <div className="timing-left-fill" ref={fillRef} />
      </div>
    </div>
  );
}
