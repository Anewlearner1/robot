import type { ScoreKey } from '../types'

/**
 * Every scoring threshold and weight lives here so milestone M2 can recalibrate
 * against real recordings without touching the algorithms.
 *
 * Convention for linear sub-scores: `full` = value at/below which the sub-score is 100,
 * `zero` = value at/above which it is 0, linear in between.
 */
export interface ScoringConfig {
  weights: Record<ScoreKey, number>
  /** Notes at least this long (s) are "long notes" for breath and vibrato. */
  longNoteSec: number
  /** Attack / release trimmed off each end of a long note before measuring (s). */
  edgeTrimSec: number
  pitch: {
    fullCents: number
    zeroCents: number
    /** Fewer valid notes than this → 未評. */
    minNotes: number
    /** Add the raised 7th (harmonic-minor leading tone) to minor scales. */
    minorIncludesLeadingTone: boolean
    /**
     * Estimate and remove a global tuning offset (singer consistently off A440) before judging.
     * Off by default: the PRD measures against the absolute (A440) scale.
     */
    compensateTuning: boolean
  }
  rhythm: {
    fullMs: number
    zeroMs: number
    /** Grid subdivision per beat (2 = eighth notes). */
    subdivisionsPerBeat: number
    /** Fewer onsets than this → 未評. */
    minOnsets: number
    /** Grid phase search step (s). */
    phaseStepSec: number
    /** Fraction of the largest deviations dropped before averaging (robust mean). */
    trimFraction: number
  }
  breath: {
    cvFull: number
    cvZero: number
    driftFull: number
    driftZero: number
    /** Moving-average window used to remove vibrato when no vibrato period was detected (s). */
    smoothSec: number
    /** Tail (last fraction of a long note) RMS drop vs. the body that counts as 尾音氣不足 (0–1). */
    tailFraction: number
    tailDropRatio: number
  }
  vibrato: {
    /** Detection limits. */
    minRateHz: number
    maxRateHz: number
    minCycles: number
    minExtentCents: number
    /** Half-periods allowed inside a vibrato run (s); looser than the rate limits so irregular vibrato is still found and penalised. */
    halfPeriodMinSec: number
    halfPeriodMaxSec: number
    /** Zero-crossing hysteresis (cents) on the detrended curve. */
    hysteresisCents: number
    /** Rate band: 100 inside [fullLow, fullHigh], 0 at/beyond zeroLow / zeroHigh. */
    rateZeroLow: number
    rateFullLow: number
    rateFullHigh: number
    rateZeroHigh: number
    /** Extent (peak-to-peak cents) band. */
    extentZeroLow: number
    extentFullLow: number
    extentFullHigh: number
    extentZeroHigh: number
    /** Period coefficient of variation (std / mean of full periods). */
    periodCvFull: number
    periodCvZero: number
  }
  issues: {
    windowSec: number
    stepSec: number
    maxIssues: number
    /** Only windows whose local item score is below this are reported. */
    badScore: number
    /** Minimum material inside a window for a local score. */
    minNotesPitch: number
    minOnsetsRhythm: number
  }
}

export const scoringConfig: ScoringConfig = {
  weights: { pitch: 0.4, rhythm: 0.2, breath: 0.2, vibrato: 0.2 },
  longNoteSec: 0.8,
  edgeTrimSec: 0.08,
  pitch: {
    fullCents: 10,
    zeroCents: 50,
    minNotes: 10,
    minorIncludesLeadingTone: true,
    compensateTuning: false,
  },
  rhythm: {
    fullMs: 30,
    zeroMs: 120,
    subdivisionsPerBeat: 2,
    minOnsets: 8,
    phaseStepSec: 0.002,
    trimFraction: 0.1,
  },
  breath: {
    cvFull: 0.1,
    cvZero: 0.4,
    driftFull: 5,
    driftZero: 30,
    smoothSec: 0.22,
    tailFraction: 0.25,
    tailDropRatio: 0.4,
  },
  vibrato: {
    minRateHz: 3,
    maxRateHz: 9,
    minCycles: 3,
    minExtentCents: 15,
    halfPeriodMinSec: 0.04,
    halfPeriodMaxSec: 0.22,
    hysteresisCents: 3,
    rateZeroLow: 3,
    rateFullLow: 4.5,
    rateFullHigh: 7,
    rateZeroHigh: 9,
    extentZeroLow: 10,
    extentFullLow: 20,
    extentFullHigh: 100,
    extentZeroHigh: 180,
    periodCvFull: 0.1,
    periodCvZero: 0.35,
  },
  issues: {
    windowSec: 3,
    stepSec: 0.5,
    maxIssues: 3,
    badScore: 70,
    minNotesPitch: 3,
    minOnsetsRhythm: 3,
  },
}
