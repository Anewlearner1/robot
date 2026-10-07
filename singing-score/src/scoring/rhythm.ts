import { scoringConfig, type ScoringConfig } from './config'
import { lin } from './util'

export interface RhythmResult {
  /** 0–100 (unrounded) or null = 未評. */
  score: number | null
  /** Robust (trimmed) mean |onset − nearest grid point|, ms. */
  meanDevMs: number
  /** Mean signed deviation of the same onsets, ms (positive = late). */
  meanSignedMs: number
  /** Grid spacing (s) and the chosen grid phase (s, in [0, gridSec)). */
  gridSec: number
  offsetSec: number
  onsetCount: number
}

/** Signed deviation (s) of t from the nearest point of the grid {offset + k·grid}. */
export function gridDeviation(t: number, gridSec: number, offsetSec: number): number {
  let d = (t - offsetSec) % gridSec
  if (d < 0) d += gridSec
  return d > gridSec / 2 ? d - gridSec : d
}

/** Mean of the smallest (1 − trim) share of values (drops the worst outliers). */
export function trimmedMean(values: number[], trim: number): number {
  if (!values.length) return NaN
  const s = [...values].sort((a, b) => a - b)
  const keep = Math.max(1, Math.ceil(s.length * (1 - trim)))
  let sum = 0
  for (let i = 0; i < keep; i++) sum += s[i]
  return sum / keep
}

/**
 * 節奏: onsets vs an eighth-note grid at `bpm`. The grid phase is unknown (the user may start
 * anywhere), so we search offsets over one grid period and keep the one with the smallest
 * trimmed-mean deviation. Pass `offsetSec` to reuse a phase (local windows for issues).
 */
export function scoreRhythm(
  onsets: number[],
  bpm: number | null,
  cfg: ScoringConfig = scoringConfig,
  opts: { offsetSec?: number; minOnsets?: number } = {},
): RhythmResult {
  const minOnsets = opts.minOnsets ?? cfg.rhythm.minOnsets
  const ons = onsets.filter(Number.isFinite)
  const empty: RhythmResult = {
    score: null,
    meanDevMs: NaN,
    meanSignedMs: NaN,
    gridSec: NaN,
    offsetSec: NaN,
    onsetCount: ons.length,
  }
  if (bpm === null || !(bpm > 0) || ons.length === 0) return empty
  const grid = 60 / bpm / cfg.rhythm.subdivisionsPerBeat
  const trim = cfg.rhythm.trimFraction
  const cost = (off: number) => trimmedMean(ons.map((t) => Math.abs(gridDeviation(t, grid, off))), trim)

  let offset = opts.offsetSec
  if (offset === undefined) {
    const step = Math.min(cfg.rhythm.phaseStepSec, grid / 20)
    let best = Infinity
    offset = 0
    for (let off = 0; off < grid; off += step) {
      const c = cost(off)
      if (c < best - 1e-12) {
        best = c
        offset = off
      }
    }
  }
  const meanDev = cost(offset)
  const signed = ons.map((t) => gridDeviation(t, grid, offset))
  const meanSigned = signed.reduce((a, b) => a + b, 0) / signed.length
  return {
    score: ons.length >= minOnsets ? lin(meanDev * 1000, cfg.rhythm.fullMs, cfg.rhythm.zeroMs) : null,
    meanDevMs: meanDev * 1000,
    meanSignedMs: meanSigned * 1000,
    gridSec: grid,
    offsetSec: offset,
    onsetCount: ons.length,
  }
}
