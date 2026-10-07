/** Synthetic voice-like signals for analysis tests (not used at runtime). */

export interface Segment {
  /** Seconds. */
  dur: number
  /** Fractional MIDI note, or null for silence. */
  midi: number | null
  /** Peak amplitude of the fundamental (default 0.3). */
  amp?: number
  /** Vibrato: rate in Hz and depth in cents (± around the centre). */
  vibratoHz?: number
  vibratoCents?: number
}

export interface SynthOptions {
  sampleRate: number
  /** Relative harmonic amplitudes; [1] = pure sine. Default voice-ish [1, 0.5, 0.33, 0.25]. */
  harmonics?: number[]
  /** White noise RMS added everywhere (default 0). */
  noise?: number
  /** Fade in/out per note, seconds (default 0.01). */
  fadeSec?: number
  seed?: number
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function midiToHz(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12)
}

export function hzToMidi(hz: number): number {
  return 69 + 12 * Math.log2(hz / 440)
}

export function synth(segments: Segment[], opts: SynthOptions): Float32Array {
  const sr = opts.sampleRate
  const harmonics = opts.harmonics ?? [1, 0.5, 0.33, 0.25]
  const fade = Math.max(1, Math.round((opts.fadeSec ?? 0.01) * sr))
  const total = segments.reduce((s, g) => s + Math.round(g.dur * sr), 0)
  const out = new Float32Array(total)
  let pos = 0
  for (const seg of segments) {
    const len = Math.round(seg.dur * sr)
    if (seg.midi !== null) {
      const f0 = midiToHz(seg.midi)
      const amp = seg.amp ?? 0.3
      let phase = 0
      for (let i = 0; i < len; i++) {
        const t = i / sr
        const cents = seg.vibratoHz ? (seg.vibratoCents ?? 0) * Math.sin(2 * Math.PI * seg.vibratoHz * t) : 0
        const f = f0 * Math.pow(2, cents / 1200)
        phase += (2 * Math.PI * f) / sr
        let v = 0
        for (let h = 0; h < harmonics.length; h++) {
          if (f * (h + 1) < sr / 2) v += harmonics[h] * Math.sin((h + 1) * phase)
        }
        const env = Math.min(1, i / fade, (len - 1 - i) / fade)
        out[pos + i] = amp * env * v
      }
    }
    pos += len
  }
  if (opts.noise) {
    const rnd = mulberry32(opts.seed ?? 1)
    const k = opts.noise * Math.sqrt(3) * 2
    for (let i = 0; i < out.length; i++) out[i] += k * (rnd() - 0.5)
  }
  return out
}
