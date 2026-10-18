/** Longest frame gap we count as play time; a bigger gap means the tab slept (offline logic covers that). */
export const MAX_TICK_MS = 2000;

export interface TimerStep {
  progressMs: number;
  fired: boolean;
}

/**
 * Advance the idle fishing timer. `progressMs` accumulates while the game is running; once it
 * reaches `intervalMs` the timer fires and the remainder carries over (so a catch is never early
 * or late by more than one tick). At most one catch fires per call.
 */
export function advanceIdleTimer(
  progressMs: number,
  dtMs: number,
  intervalMs: number,
  maxDtMs: number = MAX_TICK_MS
): TimerStep {
  const interval = Math.max(1, intervalMs);
  const dt = Number.isFinite(dtMs) ? Math.min(Math.max(0, dtMs), maxDtMs) : 0;
  const total = Math.max(0, progressMs) + dt;
  if (total >= interval) return { progressMs: Math.min(total - interval, interval - 1), fired: true };
  return { progressMs: total, fired: false };
}

/** 0..1 fill of the countdown bar. */
export function timerFraction(progressMs: number, intervalMs: number): number {
  return Math.min(1, Math.max(0, progressMs / Math.max(1, intervalMs)));
}
