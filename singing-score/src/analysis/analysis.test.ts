import { describe, expect, it } from 'vitest'
import { extractFeatures } from './index'
import { detectKey } from './key'
import { ANALYSIS_CONFIG } from './config'
import type { Note } from '../types'
import { hzToMidi, mulberry32, synth, type Segment } from './testSignals'

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  if (s.length === 0) return NaN
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

const C_MAJOR_SCALE = [60, 62, 64, 65, 67, 69, 71, 72]

function scaleSegments(midis: number[], noteSec = 0.4, gapSec = 0.05, extra: Partial<Segment> = {}): Segment[] {
  const segs: Segment[] = [{ dur: 0.2, midi: null }]
  for (const m of midis) {
    segs.push({ dur: noteSec, midi: m, ...extra })
    segs.push({ dur: gapSec, midi: null })
  }
  segs.push({ dur: 0.2, midi: null })
  return segs
}

describe('pitch accuracy (M1 gate: steady tone ≤ 10 cents)', () => {
  const freqs = [65.4, 82, 110, 220, 440, 880, 1046.5]
  for (const sr of [44100, 48000]) {
    for (const f of freqs) {
      it(`${f} Hz @ ${sr} Hz`, () => {
        const segs: Segment[] = [{ dur: 1.0, midi: hzToMidi(f) }]
        const x = synth(segs, { sampleRate: sr, noise: 0.003, seed: f })
        const feat = extractFeatures(x, sr)
        // Ignore the first/last 100 ms (fades, edge frames).
        const inner = feat.frames.filter((fr) => fr.t > 0.1 && fr.t < 0.9)
        const voiced = inner.filter((fr) => fr.hz !== null)
        expect(voiced.length / inner.length).toBeGreaterThan(0.95)
        const errs = voiced.map((fr) => Math.abs(1200 * Math.log2(fr.hz! / f)))
        const med = median(errs)
        const max = Math.max(...errs)
        const clar = median(voiced.map((fr) => fr.clarity))
        console.log(`[accuracy] ${f} Hz @ ${sr}: median ${med.toFixed(2)} c, max ${max.toFixed(2)} c, clarity ${clar.toFixed(3)}`)
        expect(med).toBeLessThanOrEqual(3)
        expect(max).toBeLessThanOrEqual(10)
      })
    }
  }

  it('pure sine at other sample rates (8k–96k) stays ≤ 10 cents', () => {
    for (const sr of [8000, 16000, 22050, 32000, 96000]) {
      for (const f of [82, 220, 880]) {
        const x = synth([{ dur: 0.6, midi: hzToMidi(f) }], { sampleRate: sr, harmonics: [1] })
        const feat = extractFeatures(x, sr)
        const voiced = feat.frames.filter((fr) => fr.t > 0.1 && fr.t < 0.5 && fr.hz !== null)
        expect(voiced.length).toBeGreaterThan(30)
        const med = median(voiced.map((fr) => Math.abs(1200 * Math.log2(fr.hz! / f))))
        console.log(`[accuracy] sine ${f} Hz @ ${sr}: median ${med.toFixed(2)} c`)
        expect(med).toBeLessThanOrEqual(10)
      }
    }
  })
})

describe('voicing', () => {
  it('silence and noise-only regions are unvoiced', () => {
    const sr = 44100
    const silence = new Float32Array(sr) // 1 s
    const rnd = mulberry32(7)
    const noise = new Float32Array(sr).map(() => 0.1 * (rnd() - 0.5) * 2)
    const tone = synth([{ dur: 1, midi: 57 }], { sampleRate: sr })
    const x = new Float32Array(3 * sr)
    x.set(silence, 0)
    x.set(noise, sr)
    x.set(tone, 2 * sr)
    const feat = extractFeatures(x, sr)
    const inSilence = feat.frames.filter((f) => f.t < 0.95)
    const inNoise = feat.frames.filter((f) => f.t > 1.05 && f.t < 1.95)
    expect(inSilence.every((f) => f.hz === null)).toBe(true)
    expect(inNoise.every((f) => f.hz === null)).toBe(true)
    const noiseClar = median(inNoise.map((f) => f.clarity))
    console.log(`[voicing] noise median clarity ${noiseClar.toFixed(3)}`)
    // The tone part is still voiced.
    const inTone = feat.frames.filter((f) => f.t > 2.1 && f.t < 2.9)
    expect(inTone.filter((f) => f.hz !== null).length / inTone.length).toBeGreaterThan(0.95)
    expect(feat.notes.length).toBe(1)
  })

  it('removes isolated octave errors', () => {
    const sr = 16000
    // A tone with a 20 ms burst one octave up in the middle.
    const x = synth(
      [
        { dur: 0.5, midi: 57 },
        { dur: 0.02, midi: 69 },
        { dur: 0.5, midi: 57 },
      ],
      { sampleRate: sr, fadeSec: 0.001 },
    )
    const feat = extractFeatures(x, sr)
    const voiced = feat.frames.filter((f) => f.hz !== null && f.t > 0.1 && f.t < 0.9)
    for (const f of voiced) expect(Math.abs(hzToMidi(f.hz!) - 57)).toBeLessThan(1.5)
    expect(feat.notes.length).toBe(1)
  })
})

describe('note segmentation', () => {
  it('C major scale → 8 notes with correct MIDI and key C 大調', () => {
    const sr = 44100
    const x = synth(scaleSegments(C_MAJOR_SCALE), { sampleRate: sr, noise: 0.002 })
    const feat = extractFeatures(x, sr)
    expect(feat.notes.length).toBe(8)
    feat.notes.forEach((n, i) => {
      expect(Math.abs(n.midi - C_MAJOR_SCALE[i])).toBeLessThanOrEqual(0.15)
      expect(n.frameEnd).toBeGreaterThan(n.frameStart)
      expect(feat.frames[n.frameStart].hz).not.toBeNull()
    })
    // Onsets at 0.2 + i * 0.45 s, within ±30 ms; durations ≈ 400 ms.
    feat.onsets.forEach((t, i) => expect(Math.abs(t - (0.2 + i * 0.45))).toBeLessThan(0.03))
    feat.notes.forEach((n) => expect(Math.abs(n.end - n.start - 0.4)).toBeLessThan(0.05))
    console.log(`[scale] key ${feat.key.label} r=${feat.key.confidence}`)
    expect(feat.key.fallback).toBe(false)
    expect(feat.key.label).toBe('C 大調')
    expect(feat.key.tonic).toBe(0)
    expect(feat.key.mode).toBe('major')
  })

  it('scale works across sample rates', () => {
    for (const sr of [8000, 16000, 22050, 48000, 96000]) {
      const x = synth(scaleSegments(C_MAJOR_SCALE), { sampleRate: sr })
      const feat = extractFeatures(x, sr)
      expect(feat.notes.map((n) => Math.round(n.midi))).toEqual(C_MAJOR_SCALE)
      expect(feat.hopSec).toBeGreaterThan(0.0095)
      expect(feat.hopSec).toBeLessThan(0.0105)
    }
  })

  it('A natural minor melody emphasising A/C/E → A 小調', () => {
    const sr = 44100
    // A3=57 C4=60 E4=64; passing D, B, G, F.
    const tune: [number, number][] = [
      [57, 0.6], [60, 0.3], [64, 0.6], [62, 0.2], [60, 0.3], [59, 0.2], [57, 0.8],
      [64, 0.4], [65, 0.2], [64, 0.4], [60, 0.4], [62, 0.2], [59, 0.2], [57, 0.9],
      [55, 0.2], [57, 0.3], [60, 0.4], [64, 0.6], [57, 1.0],
    ]
    const segs: Segment[] = [{ dur: 0.2, midi: null }]
    for (const [m, d] of tune) {
      segs.push({ dur: d, midi: m })
      segs.push({ dur: 0.04, midi: null })
    }
    const feat = extractFeatures(synth(segs, { sampleRate: sr, noise: 0.002 }), sr)
    expect(feat.notes.length).toBe(tune.length)
    console.log(`[minor] key ${feat.key.label} r=${feat.key.confidence}`)
    expect(feat.key.fallback).toBe(false)
    expect(feat.key.label).toBe('A 小調')
  })

  it('sustained 2 s note with 5.5 Hz ±40 cent vibrato → exactly 1 note', () => {
    const sr = 48000
    const segs: Segment[] = [
      { dur: 0.2, midi: null },
      { dur: 2, midi: 57, vibratoHz: 5.5, vibratoCents: 40 },
      { dur: 0.2, midi: null },
    ]
    const feat = extractFeatures(synth(segs, { sampleRate: sr, noise: 0.002 }), sr)
    expect(feat.notes.length).toBe(1)
    expect(Math.abs(feat.notes[0].midi - 57)).toBeLessThan(0.1)
    expect(feat.notes[0].end - feat.notes[0].start).toBeGreaterThan(1.9)
    // The frame curve keeps the vibrato (scoring needs it): peak-to-peak ≈ 80 cents.
    const cents = feat.frames
      .slice(feat.notes[0].frameStart + 20, feat.notes[0].frameEnd - 20)
      .filter((f) => f.hz !== null)
      .map((f) => 100 * (hzToMidi(f.hz!) - 57))
    const p2p = Math.max(...cents) - Math.min(...cents)
    console.log(`[vibrato] p2p ${p2p.toFixed(1)} c, clarity ${median(feat.frames.filter((f) => f.hz !== null).map((f) => f.clarity)).toFixed(3)}`)
    expect(p2p).toBeGreaterThan(55)
    expect(p2p).toBeLessThan(100)
  })

  it('wide vibrato (±80 cents, 4.5–7 Hz) stays one note', () => {
    for (const rate of [4.5, 5.5, 7]) {
      const segs: Segment[] = [
        { dur: 0.1, midi: null },
        { dur: 2, midi: 62, vibratoHz: rate, vibratoCents: 80 },
        { dur: 0.1, midi: null },
      ]
      const feat = extractFeatures(synth(segs, { sampleRate: 44100 }), 44100)
      expect(feat.notes.length, `rate ${rate}`).toBe(1)
      expect(Math.abs(feat.notes[0].midi - 62)).toBeLessThan(0.15)
    }
  })

  it('legato semitone step (with vibrato) splits into 2 notes', () => {
    const segs: Segment[] = [
      { dur: 0.1, midi: null },
      { dur: 0.8, midi: 60, vibratoHz: 5.5, vibratoCents: 40 },
      { dur: 0.8, midi: 61, vibratoHz: 5.5, vibratoCents: 40 },
      { dur: 0.1, midi: null },
    ]
    const sr = 44100
    const feat = extractFeatures(synth(segs, { sampleRate: sr, fadeSec: 0.002 }), sr)
    expect(feat.notes.map((n) => Math.round(n.midi))).toEqual([60, 61])
    expect(Math.abs(feat.notes[1].start - 0.9)).toBeLessThan(0.05)
  })

  it('glide between stable notes is excluded', () => {
    const sr = 22050
    // 0.4 s C4, 0.4 s linear glide C4→G4 (approximated by 20 ms steps), 0.4 s G4.
    const segs: Segment[] = [{ dur: 0.1, midi: null }, { dur: 0.4, midi: 60 }]
    for (let k = 1; k <= 20; k++) segs.push({ dur: 0.02, midi: 60 + (7 * k) / 21 })
    segs.push({ dur: 0.4, midi: 67 }, { dur: 0.1, midi: null })
    const feat = extractFeatures(synth(segs, { sampleRate: sr, fadeSec: 0.0005 }), sr)
    expect(feat.notes.map((n) => Math.round(n.midi))).toEqual([60, 67])
  })

  it('slow glide (200 cents over 500 ms) between notes is excluded', () => {
    const sr = 48000
    const segs: Segment[] = [{ dur: 0.1, midi: null }, { dur: 0.5, midi: 60 }]
    for (let k = 1; k <= 25; k++) segs.push({ dur: 0.02, midi: 60 + (2 * k) / 26 })
    segs.push({ dur: 0.5, midi: 62 }, { dur: 0.1, midi: null })
    const feat = extractFeatures(synth(segs, { sampleRate: sr, fadeSec: 0.0005 }), sr)
    expect(feat.notes.map((n) => Math.round(n.midi))).toEqual([60, 62])
    feat.notes.forEach((n, i) => expect(Math.abs(n.midi - [60, 62][i])).toBeLessThan(0.15))
  })

  it('repeated same-pitch notes separated by a short breath are separate notes', () => {
    const sr = 44100
    const segs: Segment[] = [{ dur: 0.1, midi: null }]
    for (let i = 0; i < 4; i++) segs.push({ dur: 0.3, midi: 64 }, { dur: 0.04, midi: null })
    const feat = extractFeatures(synth(segs, { sampleRate: sr }), sr)
    expect(feat.notes.length).toBe(4)
    feat.onsets.forEach((t, i) => expect(Math.abs(t - (0.1 + i * 0.34))).toBeLessThan(0.03))
  })

  it('notes shorter than 100 ms are dropped', () => {
    const sr = 16000
    const segs: Segment[] = [
      { dur: 0.1, midi: null },
      { dur: 0.06, midi: 60 },
      { dur: 0.1, midi: null },
      { dur: 0.3, midi: 64 },
      { dur: 0.1, midi: null },
    ]
    const feat = extractFeatures(synth(segs, { sampleRate: sr }), sr)
    expect(feat.notes.map((n) => Math.round(n.midi))).toEqual([64])
  })
})

describe('key detection', () => {
  const mk = (midis: number[]): Note[] =>
    midis.map((m, i) => ({ start: i * 0.5, end: i * 0.5 + 0.4, midi: m, frameStart: 0, frameEnd: 0 }))

  it('labels use one style', () => {
    const k = detectKey(mk([66, 68, 70, 71, 73, 75, 77, 78, 66, 73, 66, 70]), ANALYSIS_CONFIG)
    expect(k.label).toBe('F♯ 大調')
  })

  it('too few notes or chromatic input → fallback', () => {
    expect(detectKey(mk([60, 64, 67]), ANALYSIS_CONFIG).fallback).toBe(true)
    const chromatic = detectKey(mk([60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71]), ANALYSIS_CONFIG)
    expect(chromatic.fallback).toBe(true)
    expect(chromatic.label).toBe('未定（最近半音）')
  })
})

describe('edge cases', () => {
  it('empty, very short and all-silent input do not throw', () => {
    for (const x of [new Float32Array(0), new Float32Array(100), new Float32Array(500).fill(0.1), new Float32Array(48000 * 2)]) {
      const feat = extractFeatures(x, 48000)
      expect(feat.notes).toEqual([])
      expect(feat.onsets).toEqual([])
      expect(feat.key.fallback).toBe(true)
      expect(feat.key.label).toBe('未定（最近半音）')
      expect(feat.frames.every((f) => f.hz === null)).toBe(true)
      expect(feat.durationSec).toBeCloseTo(x.length / 48000)
    }
  })

  it('frames are centred at i * hopSec', () => {
    const feat = extractFeatures(new Float32Array(16000), 16000)
    expect(feat.frames.length).toBe(100)
    feat.frames.forEach((f, i) => expect(f.t).toBeCloseTo(i * feat.hopSec, 6))
  })
})

describe('performance', () => {
  it('60 s of 48 kHz melody analyses in < 1.5 s', () => {
    const sr = 48000
    const rnd = mulberry32(42)
    const scale = [0, 2, 4, 5, 7, 9, 11]
    const segs: Segment[] = []
    let total = 0
    let deg = 7
    while (total < 60) {
      deg = Math.max(0, Math.min(13, deg + Math.round((rnd() - 0.5) * 4)))
      const m = 55 + 12 * Math.floor(deg / 7) + scale[deg % 7]
      const d = 0.2 + rnd() * 0.6
      segs.push({ dur: d, midi: m, vibratoHz: d > 0.5 ? 5.5 : undefined, vibratoCents: 30 })
      segs.push({ dur: 0.05, midi: null })
      total += d + 0.05
    }
    const x = synth(segs, { sampleRate: sr, noise: 0.003 })
    extractFeatures(x.subarray(0, sr), sr) // warm-up (JIT)
    const t0 = performance.now()
    const feat = extractFeatures(x, sr)
    const ms = performance.now() - t0
    console.log(`[perf] ${(x.length / sr).toFixed(1)} s @ ${sr} Hz → ${ms.toFixed(0)} ms, ${feat.frames.length} frames, ${feat.notes.length} notes (${segs.length / 2} sung), key ${feat.key.label}`)
    expect(ms).toBeLessThan(1500)
    expect(feat.notes.length).toBeGreaterThan(segs.length / 2 - 5)
  })
})
