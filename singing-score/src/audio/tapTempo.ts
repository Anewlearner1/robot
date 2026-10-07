export interface TapTempo {
  /** Register a tap. Returns the rounded BPM once ≥ 4 taps are in the current sequence, else null. */
  tap(nowMs?: number): number | null
  reset(): void
  /** Taps in the current sequence (a pause > 2 s starts a new sequence). */
  readonly count: number
}

export const TAP_MIN_TAPS = 4
/** Median is taken over at most this many of the most recent intervals. */
export const TAP_MAX_INTERVALS = 8
/** An interval longer than this restarts the sequence. */
export const TAP_RESET_MS = 2000
export const TAP_MIN_BPM = 40
export const TAP_MAX_BPM = 240

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

/**
 * Tap-tempo estimator: median of the last ≤ 8 inter-tap intervals, robust to a
 * single early/late tap. A gap > 2 s restarts the sequence (that tap becomes the first).
 * Non-increasing timestamps (duplicate events) are ignored. Result clamped to 40–240.
 */
export function createTapTempo(): TapTempo {
  /** Most recent ≤ 9 tap times of the current sequence. */
  let taps: number[] = []
  /** Total taps in the current sequence (not capped). */
  let n = 0

  function estimate(): number | null {
    if (taps.length < TAP_MIN_TAPS) return null
    const intervals: number[] = []
    for (let i = 1; i < taps.length; i++) intervals.push(taps[i] - taps[i - 1])
    const bpm = 60000 / median(intervals)
    return Math.round(Math.min(TAP_MAX_BPM, Math.max(TAP_MIN_BPM, bpm)))
  }

  return {
    tap(nowMs?: number): number | null {
      const t = nowMs ?? now()
      const last = taps.length ? taps[taps.length - 1] : undefined
      if (last !== undefined) {
        if (t <= last) return estimate()
        if (t - last > TAP_RESET_MS) {
          taps = []
          n = 0
        }
      }
      taps.push(t)
      n++
      if (taps.length > TAP_MAX_INTERVALS + 1) taps = taps.slice(-(TAP_MAX_INTERVALS + 1))
      return estimate()
    },
    reset(): void {
      taps = []
      n = 0
    },
    get count(): number {
      return n
    },
  }
}
