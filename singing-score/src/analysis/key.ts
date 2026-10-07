import type { KeyInfo, Mode, Note } from '../types'
import type { AnalysisConfig } from './config'

/** Krumhansl–Kessler probe-tone profiles, index 0 = tonic. */
export const KK_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
export const KK_MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]

/** Conventional spelling of each tonic (fewest accidentals), ♯/♭ symbols. */
const MAJOR_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B']
const MINOR_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'B♭', 'B']

export const FALLBACK_LABEL = '未定（最近半音）'

export function keyLabel(tonic: number, mode: Mode): string {
  return mode === 'major' ? `${MAJOR_NAMES[tonic]} 大調` : `${MINOR_NAMES[tonic]} 小調`
}

function pearson(x: ArrayLike<number>, y: ArrayLike<number>, rot: number): number {
  let mx = 0
  let my = 0
  for (let i = 0; i < 12; i++) {
    mx += x[i]
    my += y[i]
  }
  mx /= 12
  my /= 12
  let sxy = 0
  let sxx = 0
  let syy = 0
  for (let i = 0; i < 12; i++) {
    const a = x[(i + rot) % 12] - mx
    const b = y[i] - my
    sxy += a * b
    sxx += a * a
    syy += b * b
  }
  if (sxx === 0 || syy === 0) return 0
  return sxy / Math.sqrt(sxx * syy)
}

/** Duration-weighted pitch-class histogram (pitch class of the rounded note MIDI). */
export function pitchClassHistogram(notes: Note[]): number[] {
  const h = new Array<number>(12).fill(0)
  for (const n of notes) {
    const pc = ((Math.round(n.midi) % 12) + 12) % 12
    h[pc] += Math.max(0, n.end - n.start)
  }
  return h
}

export interface KeyCandidate {
  tonic: number
  mode: Mode
  r: number
}

/** All 24 key correlations, best first. */
export function rankKeys(hist: ArrayLike<number>): KeyCandidate[] {
  const out: KeyCandidate[] = []
  for (let tonic = 0; tonic < 12; tonic++) {
    out.push({ tonic, mode: 'major', r: pearson(hist, KK_MAJOR, tonic) })
    out.push({ tonic, mode: 'minor', r: pearson(hist, KK_MINOR, tonic) })
  }
  return out.sort((a, b) => b.r - a.r)
}

/** Same diatonic collection: relative major/minor (or identical key). */
function sameCollection(a: KeyCandidate, b: KeyCandidate): boolean {
  const majorTonic = (k: KeyCandidate): number => (k.mode === 'major' ? k.tonic : (k.tonic + 3) % 12)
  return majorTonic(a) === majorTonic(b)
}

/**
 * Key detection (PRD 調性偵測): Krumhansl–Kessler template matching.
 * Fallback (judge pitch against the nearest semitone) when there are too few notes, the best
 * correlation is weak, or a key with a different pitch collection scores almost as well.
 * The relative major/minor shares the collection, so it is excluded from the margin test.
 */
export function detectKey(notes: Note[], cfg: AnalysisConfig): KeyInfo {
  const hist = pitchClassHistogram(notes)
  const total = hist.reduce((a, b) => a + b, 0)
  if (notes.length === 0 || total <= 0) {
    return { tonic: 0, mode: 'major', confidence: 0, fallback: true, label: FALLBACK_LABEL }
  }
  const ranked = rankKeys(hist)
  const best = ranked[0]
  const rival = ranked.find((k) => !sameCollection(k, best))
  const margin = rival ? best.r - rival.r : best.r
  const confidence = Math.max(0, Math.min(1, best.r))
  const fallback =
    notes.length < cfg.keyMinNotes || best.r < cfg.keyMinCorrelation || margin < cfg.keyMinMargin
  return {
    tonic: best.tonic,
    mode: best.mode,
    confidence: +confidence.toFixed(3),
    fallback,
    label: fallback ? FALLBACK_LABEL : keyLabel(best.tonic, best.mode),
  }
}
