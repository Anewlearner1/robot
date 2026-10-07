import type { AnalysisFeatures, Note } from '../types'
import { scoringConfig, type ScoringConfig } from './config'
import { band, isLongNote, lin, linreg, mean, median, noteBody, noteDuration, std, weightedMean } from './util'

export interface NoteVibrato {
  note: Note
  /** Mean rate over the vibrato run, Hz. */
  rateHz: number
  /** Median peak-to-peak excursion between adjacent extrema, cents. */
  extentCents: number
  /** std / mean of full periods inside the run. */
  periodCv: number
  cycles: number
  /** Start / end of the detected vibrato run (s). */
  start: number
  end: number
  rateScore: number
  extentScore: number
  regularityScore: number
  /** 0–100 for this note: mean of the three sub-scores. */
  score: number
}

export interface VibratoResult {
  /** 0–100 (unrounded) or null = 未評 (no vibrato detected — not a penalty). */
  score: number | null
  /** Duration-weighted means over notes with vibrato. */
  rateHz: number
  extentCents: number
  periodCv: number
  detectedCount: number
  longNoteCount: number
  perNote: NoteVibrato[]
}

/**
 * Detect vibrato in one note. Method: trim attack/release, linearly detrend the cents curve,
 * 3-frame smoothing, zero crossings with hysteresis, then the longest run of consecutive
 * half-cycles whose length is plausible for vibrato (so delayed vibrato after a straight onset is
 * still found). Detected when the run has ≥ minCycles full cycles, its mean rate is within
 * [minRateHz, maxRateHz] and its median peak-to-peak extent ≥ minExtentCents.
 * Extent = peak-to-peak (cents) between adjacent opposite extrema, median over the run.
 */
export function detectNoteVibrato(
  features: AnalysisFeatures,
  note: Note,
  cfg: ScoringConfig = scoringConfig,
): NoteVibrato | null {
  const v = cfg.vibrato
  const body = noteBody(features, note, cfg.edgeTrimSec)
  const { t } = body
  if (!body.cents || t.length < 8) return null
  const { slope, intercept } = linreg(t, body.cents)
  const det = body.cents.map((c, i) => c - (slope * t[i] + intercept))
  const x = det.map((_, i) => mean(det.slice(Math.max(0, i - 1), Math.min(det.length, i + 2))))

  // zero crossings with hysteresis, and the extremum of each half-cycle
  const crossings: number[] = []
  const extrema: number[] = []
  let state = 0
  let pendingZero = t[0]
  let extreme = 0
  for (let i = 0; i < x.length; i++) {
    if (i > 0 && Math.sign(x[i]) !== Math.sign(x[i - 1]) && x[i] !== x[i - 1]) {
      pendingZero = t[i - 1] + ((t[i] - t[i - 1]) * (0 - x[i - 1])) / (x[i] - x[i - 1])
    }
    const s = x[i] > v.hysteresisCents ? 1 : x[i] < -v.hysteresisCents ? -1 : 0
    if (s !== 0 && s !== state) {
      if (state !== 0) {
        crossings.push(pendingZero)
        extrema.push(extreme)
      }
      state = s
      extreme = x[i]
    } else if (state !== 0 && (state > 0 ? x[i] > extreme : x[i] < extreme)) {
      extreme = x[i]
    }
  }
  // extrema[k] is the extremum of the half-cycle ending at crossings[k]; half-cycle k (between
  // crossings[k] and crossings[k+1]) therefore has extremum extrema[k+1].
  const half: { len: number; ext: number }[] = []
  for (let k = 0; k + 1 < crossings.length; k++) {
    half.push({ len: crossings[k + 1] - crossings[k], ext: extrema[k + 1] })
  }

  // longest run of plausible half-cycles
  let bestStart = 0
  let bestLen = 0
  for (let k = 0; k < half.length; ) {
    if (half[k].len < v.halfPeriodMinSec || half[k].len > v.halfPeriodMaxSec) {
      k++
      continue
    }
    let j = k
    while (j < half.length && half[j].len >= v.halfPeriodMinSec && half[j].len <= v.halfPeriodMaxSec) j++
    if (j - k > bestLen) {
      bestLen = j - k
      bestStart = k
    }
    k = j
  }
  if (bestLen < 2 * v.minCycles) return null
  const run = half.slice(bestStart, bestStart + bestLen)
  const periods: number[] = []
  for (let k = 0; k + 1 < run.length; k++) periods.push(run[k].len + run[k + 1].len)
  const meanPeriod = mean(periods)
  const rateHz = 1 / meanPeriod
  const periodCv = std(periods) / meanPeriod
  const p2p: number[] = []
  for (let k = 0; k + 1 < run.length; k++) p2p.push(Math.abs(run[k].ext - run[k + 1].ext))
  const extentCents = median(p2p)
  if (rateHz < v.minRateHz || rateHz > v.maxRateHz || extentCents < v.minExtentCents) return null

  const rateScore = band(rateHz, v.rateZeroLow, v.rateFullLow, v.rateFullHigh, v.rateZeroHigh)
  const extentScore = band(extentCents, v.extentZeroLow, v.extentFullLow, v.extentFullHigh, v.extentZeroHigh)
  const regScore = lin(periodCv, v.periodCvFull, v.periodCvZero)
  return {
    note,
    rateHz,
    extentCents,
    periodCv,
    cycles: run.length / 2,
    start: crossings[bestStart],
    end: crossings[bestStart + bestLen],
    rateScore,
    extentScore,
    regularityScore: regScore,
    score: (rateScore + extentScore + regScore) / 3,
  }
}

/** 顫音: per long note detect vibrato and score rate / extent / regularity; null when none found. */
export function scoreVibrato(
  features: AnalysisFeatures,
  notes: Note[],
  cfg: ScoringConfig = scoringConfig,
): VibratoResult {
  const long = notes.filter((n) => isLongNote(n, cfg.longNoteSec))
  const perNote = long.map((n) => detectNoteVibrato(features, n, cfg)).filter((r): r is NoteVibrato => r !== null)
  const w = perNote.map((r) => noteDuration(r.note))
  return {
    score: perNote.length ? weightedMean(perNote.map((r) => r.score), w) : null,
    rateHz: weightedMean(perNote.map((r) => r.rateHz), w),
    extentCents: weightedMean(perNote.map((r) => r.extentCents), w),
    periodCv: weightedMean(perNote.map((r) => r.periodCv), w),
    detectedCount: perNote.length,
    longNoteCount: long.length,
    perNote,
  }
}
