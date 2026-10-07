import type { AnalysisFeatures, Note } from '../types'
import { scoringConfig, type ScoringConfig } from './config'
import { hopOf, isLongNote, lin, linreg, mean, movingAverage, noteBody, noteDuration, std, weightedMean } from './util'
import { detectNoteVibrato } from './vibrato'

export interface NoteBreath {
  note: Note
  /** Coefficient of variation of the (vibrato-smoothed) frame RMS, 0–1. */
  cv: number
  /** Signed slope of the vibrato-smoothed pitch, cents/s (negative = sagging). */
  driftCentsPerSec: number
  /** 1 − RMS(tail) / RMS(body before the tail); > tailDropRatio reads as 尾音氣不足. */
  tailDrop: number
  cvScore: number
  driftScore: number
  score: number
}

export interface BreathResult {
  /** 0–100 (unrounded) or null = 未評 (no long notes). */
  score: number | null
  /** Duration-weighted means over long notes (drift as |cents/s|). */
  cv: number
  absDriftCentsPerSec: number
  longNoteCount: number
  perNote: NoteBreath[]
}

/**
 * Breath on one long note. Attack/release (edgeTrimSec) is ignored. Vibrato is removed with a
 * moving average exactly one vibrato period long when vibrato was detected in the note
 * (a boxcar of one period nulls the oscillation), otherwise breath.smoothSec. The same smoothing
 * is applied to RMS so tremolo that accompanies vibrato is not counted as unsteady breath.
 * Drift = |slope| of a linear regression on the smoothed pitch.
 */
export function analyzeNoteBreath(
  features: AnalysisFeatures,
  note: Note,
  cfg: ScoringConfig = scoringConfig,
): NoteBreath | null {
  const b = cfg.breath
  const body = noteBody(features, note, cfg.edgeTrimSec)
  if (!body.cents || body.t.length < 4) return null
  const hop = hopOf(features)
  const vib = detectNoteVibrato(features, note, cfg)
  const smoothSec = vib ? 1 / vib.rateHz : b.smoothSec
  let w = Math.max(1, Math.round(smoothSec / hop))
  if (w > body.t.length / 2) w = Math.max(1, Math.floor(body.t.length / 2))

  const tS = movingAverage(body.t, w)
  const cS = movingAverage(body.cents, w)
  const rS = movingAverage(body.rms, w)
  const drift = tS.length >= 2 ? linreg(tS, cS).slope : 0
  const m = mean(rS)
  const cv = m > 0 ? std(rS) / m : 0

  const nTail = Math.max(1, Math.round(rS.length * b.tailFraction))
  const tailRms = mean(rS.slice(rS.length - nTail))
  const bodyRms = mean(rS.slice(0, Math.max(1, rS.length - nTail)))
  const tailDrop = bodyRms > 0 ? 1 - tailRms / bodyRms : 0

  const cvScore = lin(cv, b.cvFull, b.cvZero)
  const driftScore = lin(Math.abs(drift), b.driftFull, b.driftZero)
  return { note, cv, driftCentsPerSec: drift, tailDrop, cvScore, driftScore, score: (cvScore + driftScore) / 2 }
}

/** 氣息: volume steadiness and pitch drift within long notes; duration-weighted over long notes. */
export function scoreBreath(
  features: AnalysisFeatures,
  notes: Note[],
  cfg: ScoringConfig = scoringConfig,
): BreathResult {
  const perNote = notes
    .filter((n) => isLongNote(n, cfg.longNoteSec))
    .map((n) => analyzeNoteBreath(features, n, cfg))
    .filter((r): r is NoteBreath => r !== null)
  const w = perNote.map((r) => noteDuration(r.note))
  return {
    score: perNote.length ? weightedMean(perNote.map((r) => r.score), w) : null,
    cv: weightedMean(perNote.map((r) => r.cv), w),
    absDriftCentsPerSec: weightedMean(perNote.map((r) => Math.abs(r.driftCentsPerSec)), w),
    longNoteCount: perNote.length,
    perNote,
  }
}
