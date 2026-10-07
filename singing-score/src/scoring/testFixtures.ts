// Hand-built AnalysisFeatures fixtures for scoring tests (no dependency on src/analysis).
import type { AnalysisFeatures, KeyInfo, Note } from '../types'

export const HOP = 0.01

export const C_MAJOR: KeyInfo = { tonic: 0, mode: 'major', confidence: 0.9, fallback: false, label: 'C 大調' }
export const FALLBACK_KEY: KeyInfo = { tonic: 0, mode: 'major', confidence: 0.2, fallback: true, label: '未定（最近半音）' }

export interface NoteSpec {
  start: number
  dur: number
  midi: number
  /** Pitch offset in cents as a function of time since note start. */
  cents?: (tRel: number) => number
  /** Frame RMS as a function of time since note start (default 0.2). */
  rms?: (tRel: number) => number
}

/** Frames every 10 ms; voiced inside notes, silent outside. Note.midi = median of its frames. */
export function buildFeatures(
  specs: NoteSpec[],
  opts: { duration?: number; key?: KeyInfo; onsets?: number[] } = {},
): AnalysisFeatures {
  const sorted = [...specs].sort((a, b) => a.start - b.start)
  const lastEnd = sorted.length ? Math.max(...sorted.map((s) => s.start + s.dur)) : 0
  const duration = opts.duration ?? lastEnd + 0.5
  const n = Math.ceil(duration / HOP)
  const frames: AnalysisFeatures['frames'] = []
  for (let i = 0; i < n; i++) {
    const t = +(i * HOP).toFixed(6)
    const s = sorted.find((x) => t >= x.start - 1e-9 && t < x.start + x.dur - 1e-9)
    if (!s) {
      frames.push({ t, hz: null, clarity: 0.1, rms: 0.005 })
      continue
    }
    const tr = t - s.start
    const midi = s.midi + (s.cents ? s.cents(tr) : 0) / 100
    frames.push({ t, hz: 440 * 2 ** ((midi - 69) / 12), clarity: 0.95, rms: s.rms ? s.rms(tr) : 0.2 })
  }
  const notes: Note[] = sorted.map((s) => {
    const frameStart = Math.ceil(s.start / HOP - 1e-9)
    const frameEnd = Math.min(n, Math.ceil((s.start + s.dur) / HOP - 1e-9))
    const ms = frames
      .slice(frameStart, frameEnd)
      .map((f) => 69 + 12 * Math.log2((f.hz as number) / 440))
      .sort((a, b) => a - b)
    const midi = ms.length ? ms[ms.length >> 1] : s.midi
    return { start: s.start, end: s.start + s.dur, midi, frameStart, frameEnd }
  })
  return {
    sampleRate: 44100,
    durationSec: duration,
    hopSec: HOP,
    frames,
    notes,
    key: opts.key ?? C_MAJOR,
    onsets: opts.onsets ?? notes.map((x) => x.start),
  }
}

const C_SCALE = [60, 62, 64, 65, 67, 69, 71, 72]

/** `count` notes walking the C major scale. */
export function scaleNotes(
  count: number,
  o: { start?: number; dur?: number; step?: number; cents?: number } = {},
): NoteSpec[] {
  const { start = 0.2, dur = 0.4, step = 0.5, cents = 0 } = o
  return Array.from({ length: count }, (_, i) => ({
    start: start + i * step,
    dur,
    midi: C_SCALE[i % C_SCALE.length],
    cents: cents ? () => cents : undefined,
  }))
}

export const sine = (hz: number, amp: number) => (t: number) => amp * Math.sin(2 * Math.PI * hz * t)

/** Deterministic pseudo-random in [−1, 1). */
export function lcg(seed = 1): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return (s / 2 ** 32) * 2 - 1
  }
}

/**
 * A realistic 'good' song: bpm 100 (eighth = 0.3 s). Each 4.2 s phrase = 4 short notes on
 * every other eighth + one 1.6 s long note (with gentle 5.5 Hz vibrato on odd phrases).
 * `mod` lets a test damage individual notes.
 */
export const SONG_BPM = 100
export function songSpecs(
  phrases: number,
  mod: (spec: NoteSpec, phrase: number, idx: number) => NoteSpec = (s) => s,
): NoteSpec[] {
  const out: NoteSpec[] = []
  for (let p = 0; p < phrases; p++) {
    const base = p * 4.2
    for (let k = 0; k < 4; k++) {
      out.push(mod({ start: base + k * 0.6, dur: 0.5, midi: C_SCALE[(p + k) % 7] }, p, k))
    }
    out.push(
      mod(
        { start: base + 2.4, dur: 1.6, midi: C_SCALE[(p + 4) % 7], cents: p % 2 ? sine(5.5, 25) : undefined },
        p,
        4,
      ),
    )
  }
  return out
}
