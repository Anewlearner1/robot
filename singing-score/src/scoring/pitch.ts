import type { KeyInfo, Note } from '../types'
import { scoringConfig, type ScoringConfig } from './config'
import { lin, noteDuration, weightedMean } from './util'

const MAJOR = [0, 2, 4, 5, 7, 9, 11]
const NATURAL_MINOR = [0, 2, 3, 5, 7, 8, 10]
const CHROMATIC = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]

export interface PitchResult {
  /** 0–100 (unrounded) or null = 未評. */
  score: number | null
  /** Duration-weighted mean |deviation| from the nearest allowed pitch, cents. */
  meanAbsCents: number
  /** Duration-weighted mean signed deviation, cents (negative = flat). */
  meanSignedCents: number
  /** Global tuning offset that was removed (0 unless compensateTuning). */
  tuningOffsetCents: number
  noteCount: number
}

/** Pitch classes (absolute, 0 = C) the singer is judged against. */
export function allowedPitchClasses(key: KeyInfo, cfg: ScoringConfig = scoringConfig): number[] {
  if (key.fallback) return CHROMATIC
  const rel =
    key.mode === 'major'
      ? MAJOR
      : cfg.pitch.minorIncludesLeadingTone
        ? [...NATURAL_MINOR, 11]
        : NATURAL_MINOR
  return rel.map((pc) => (pc + key.tonic) % 12)
}

/** Signed deviation in cents of a fractional MIDI pitch from the nearest allowed pitch class. */
export function deviationCents(midi: number, pcs: number[]): number {
  let best = Infinity
  for (const pc of pcs) {
    // signed distance in semitones to the nearest instance of pc, in (−6, 6]
    let d = (((midi - pc) % 12) + 12) % 12
    if (d > 6) d -= 12
    if (Math.abs(d) < Math.abs(best)) best = d
  }
  return best * 100
}

function validNotes(notes: Note[]): Note[] {
  return notes.filter((n) => Number.isFinite(n.midi) && noteDuration(n) > 0)
}

/**
 * 音準: each note's median pitch vs the nearest note of the key's scale (nearest semitone when
 * key.fallback), duration-weighted mean absolute deviation in cents.
 */
export function scorePitch(
  notes: Note[],
  key: KeyInfo,
  cfg: ScoringConfig = scoringConfig,
  minNotes: number = cfg.pitch.minNotes,
): PitchResult {
  const valid = validNotes(notes)
  const pcs = allowedPitchClasses(key, cfg)
  const weights = valid.map(noteDuration)

  let offset = 0
  if (cfg.pitch.compensateTuning && valid.length) {
    // circular duration-weighted mean of the semitone residual (period 100 cents)
    let c = 0
    let s = 0
    valid.forEach((n, i) => {
      const a = (2 * Math.PI * deviationCents(n.midi, CHROMATIC)) / 100
      c += weights[i] * Math.cos(a)
      s += weights[i] * Math.sin(a)
    })
    offset = (Math.atan2(s, c) * 100) / (2 * Math.PI)
  }

  const devs = valid.map((n) => deviationCents(n.midi - offset / 100, pcs))
  const meanAbsCents = valid.length ? weightedMean(devs.map(Math.abs), weights) : NaN
  const meanSignedCents = valid.length ? weightedMean(devs, weights) : NaN
  const score =
    valid.length >= minNotes && valid.length > 0
      ? lin(meanAbsCents, cfg.pitch.fullCents, cfg.pitch.zeroCents)
      : null
  return { score, meanAbsCents, meanSignedCents, tuningOffsetCents: offset, noteCount: valid.length }
}
