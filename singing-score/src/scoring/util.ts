import type { AnalysisFeatures, Note } from '../types'

/** 100 at value ≤ full, 0 at value ≥ zero, linear in between (works for full > zero too). */
export function lin(value: number, full: number, zero: number): number {
  if (full === zero) return value <= full ? 100 : 0
  const s = ((zero - value) / (zero - full)) * 100
  return Math.max(0, Math.min(100, s))
}

/** 100 inside [fullLow, fullHigh], linear down to 0 at zeroLow / zeroHigh. */
export function band(value: number, zeroLow: number, fullLow: number, fullHigh: number, zeroHigh: number): number {
  if (value < fullLow) return lin(-value, -fullLow, -zeroLow)
  if (value > fullHigh) return lin(value, fullHigh, zeroHigh)
  return 100
}

export function weightedMean(values: number[], weights: number[]): number {
  let s = 0
  let w = 0
  for (let i = 0; i < values.length; i++) {
    s += values[i] * weights[i]
    w += weights[i]
  }
  return w > 0 ? s / w : NaN
}

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN
}

export function std(xs: number[]): number {
  const m = mean(xs)
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)))
}

export function median(xs: number[]): number {
  if (!xs.length) return NaN
  const s = [...xs].sort((a, b) => a - b)
  const h = s.length >> 1
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2
}

/** Least-squares slope and intercept of y over x. */
export function linreg(x: number[], y: number[]): { slope: number; intercept: number } {
  const mx = mean(x)
  const my = mean(y)
  let sxy = 0
  let sxx = 0
  for (let i = 0; i < x.length; i++) {
    sxy += (x[i] - mx) * (y[i] - my)
    sxx += (x[i] - mx) ** 2
  }
  const slope = sxx > 0 ? sxy / sxx : 0
  return { slope, intercept: my - slope * mx }
}

/** Moving average over `w` samples, "valid" mode (output length n − w + 1). */
export function movingAverage(xs: number[], w: number): number[] {
  const win = Math.max(1, Math.min(w, xs.length))
  if (xs.length === 0) return []
  const out: number[] = []
  let s = 0
  for (let i = 0; i < xs.length; i++) {
    s += xs[i]
    if (i >= win) s -= xs[i - win]
    if (i >= win - 1) out.push(s / win)
  }
  return out
}

export function hzToMidi(hz: number): number {
  return 69 + 12 * Math.log2(hz / 440)
}

export function noteDuration(n: Note): number {
  return Math.max(0, n.end - n.start)
}

export function isLongNote(n: Note, longNoteSec: number): boolean {
  return noteDuration(n) >= longNoteSec
}

export function hopOf(features: AnalysisFeatures): number {
  if (features.hopSec > 0) return features.hopSec
  const f = features.frames
  return f.length > 1 ? (f[f.length - 1].t - f[0].t) / (f.length - 1) : 0.01
}

/**
 * Frames of a note with the attack/release trimmed, as parallel arrays.
 * `cents` is relative to the note's median (note.midi), with unvoiced gaps linearly interpolated
 * (null when the note has no voiced frame at all).
 */
export function noteBody(
  features: AnalysisFeatures,
  note: Note,
  trimSec: number,
): { t: number[]; cents: number[] | null; rms: number[] } {
  const frames = features.frames
  const lo = Math.max(0, Math.min(frames.length, note.frameStart))
  const hi = Math.max(lo, Math.min(frames.length, note.frameEnd))
  const t: number[] = []
  const raw: (number | null)[] = []
  const rms: number[] = []
  for (let i = lo; i < hi; i++) {
    const f = frames[i]
    if (f.t < note.start + trimSec || f.t > note.end - trimSec) continue
    t.push(f.t)
    raw.push(f.hz !== null && f.hz > 0 ? (hzToMidi(f.hz) - note.midi) * 100 : null)
    rms.push(f.rms)
  }
  return { t, cents: interpolateGaps(raw), rms }
}

function interpolateGaps(raw: (number | null)[]): number[] | null {
  const n = raw.length
  const prev = new Array<number>(n).fill(-1)
  const next = new Array<number>(n).fill(-1)
  for (let i = 0, last = -1; i < n; i++) {
    if (raw[i] !== null) last = i
    prev[i] = last
  }
  for (let i = n - 1, last = -1; i >= 0; i--) {
    if (raw[i] !== null) last = i
    next[i] = last
  }
  if (n === 0 || (prev[n - 1] === -1 && next[0] === -1)) return null
  return raw.map((v, i) => {
    if (v !== null) return v
    const a = prev[i]
    const b = next[i]
    if (a === -1) return raw[b] as number
    if (b === -1) return raw[a] as number
    const va = raw[a] as number
    const vb = raw[b] as number
    return va + ((vb - va) * (i - a)) / (b - a)
  })
}

/** "m:ss" */
export function formatTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
