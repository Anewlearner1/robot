import { describe, expect, it } from 'vitest'
import { mulberry32, synth, type Segment } from './analysis/testSignals'
import { analyze } from './pipeline'

const SR = 48000
const BPM = 100
const EIGHTH = 60 / BPM / 2 // 0.3 s
const GAP = 0.04

// C-major phrase: [MIDI, length in eighths]; 4-eighth notes are long notes (≥ 0.8 s).
const PHRASE: [number, number][] = [
  [60, 1], [62, 1], [64, 1], [65, 1], [67, 4], [65, 1], [64, 1], [62, 1], [60, 1],
  [64, 2], [67, 2], [72, 4], [71, 1], [69, 1], [67, 1], [65, 1], [64, 4], [62, 2], [60, 4],
]

interface Singer {
  centsOff: (i: number) => number
  timingJitterSec: number
  vibrato: boolean
}

function perform(s: Singer, repeats: number, seed = 1): Float32Array {
  const rand = mulberry32(seed)
  const segs: Segment[] = [{ dur: 0.37, midi: null }] // arbitrary grid phase
  let n = 0
  for (let r = 0; r < repeats; r++) {
    for (const [midi, eighths] of PHRASE) {
      const jitter = (rand() * 2 - 1) * s.timingJitterSec
      const long = eighths >= 4
      segs.push({ dur: Math.max(0.02, GAP + jitter), midi: null })
      segs.push({
        dur: eighths * EIGHTH - GAP - jitter,
        midi: midi + s.centsOff(n++) / 100,
        ...(long && s.vibrato ? { vibratoHz: 5.5, vibratoCents: 30 } : {}),
      })
    }
  }
  segs.push({ dur: 0.5, midi: null })
  return synth(segs, { sampleRate: SR, noise: 0.002, seed })
}

describe('analyze() end to end on synthetic singing', () => {
  const good = analyze(perform({ centsOff: () => 0, timingJitterSec: 0, vibrato: true }, 2), SR, BPM)
  const bad = analyze(
    perform({ centsOff: (i) => (i % 2 ? 35 : -30), timingJitterSec: 0.09, vibrato: false }, 2, 7),
    SR,
    BPM,
  )

  it('scores an in-tune, on-beat take highly on every item', () => {
    expect(good.key.label).toMatch(/C 大調|A 小調/)
    expect(good.scores.pitch).toBeGreaterThanOrEqual(90)
    expect(good.scores.rhythm).toBeGreaterThanOrEqual(85)
    expect(good.scores.breath).toBeGreaterThanOrEqual(85)
    expect(good.scores.vibrato).toBeGreaterThanOrEqual(80)
    expect(good.scores.total).toBeGreaterThanOrEqual(85)
    expect(good.issues).toHaveLength(0)
    expect(good.pitchSummary.length).toBeGreaterThan(100)
  })

  it('ranks an out-of-tune, off-beat take lower and explains why', () => {
    expect(bad.scores.pitch!).toBeLessThan(good.scores.pitch! - 30)
    expect(bad.scores.rhythm!).toBeLessThan(good.scores.rhythm! - 20)
    expect(bad.scores.vibrato).toBeNull() // no vibrato is 未評, not a penalty
    expect(bad.scores.total!).toBeLessThan(good.scores.total!)
    expect(bad.issues.length).toBeGreaterThan(0)
    expect(bad.issues.length).toBeLessThanOrEqual(3)
  })

  it('without BPM leaves rhythm 未評', () => {
    const r = analyze(perform({ centsOff: () => 0, timingJitterSec: 0, vibrato: false }, 1), SR, null)
    expect(r.scores.rhythm).toBeNull()
    expect(r.scores.total).not.toBeNull()
  })

  it('analyses 60 s of audio well within the 5 s phone budget', () => {
    const audio = perform({ centsOff: () => 0, timingJitterSec: 0.02, vibrato: true }, 6)
    const t0 = performance.now()
    const r = analyze(audio, SR, BPM)
    const ms = performance.now() - t0
    console.log(`e2e: ${r.durationSec.toFixed(1)} s audio analysed in ${ms.toFixed(0)} ms`, r.scores)
    expect(r.durationSec).toBeGreaterThan(55)
    expect(ms).toBeLessThan(2000)
  })
})
