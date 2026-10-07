import { describe, expect, it } from 'vitest'
import { scoreFeatures } from './index'
import { buildFeatures, lcg, scaleNotes, sine, type NoteSpec } from './testFixtures'
import { scoreVibrato } from './vibrato'

const vib = (specs: NoteSpec[]) => {
  const f = buildFeatures(specs)
  return scoreVibrato(f, f.notes)
}

/** Vibrato built from explicit half-period lengths (s), amplitude ±amp cents. */
function halfCycles(halves: number[], amp: number): (t: number) => number {
  const edges = [0]
  for (const h of halves) edges.push(edges[edges.length - 1] + h)
  return (t) => {
    const k = edges.findIndex((e, i) => i > 0 && t < e)
    if (k < 1) return 0
    const a = edges[k - 1]
    const sign = (k - 1) % 2 ? -1 : 1
    return sign * amp * Math.sin((Math.PI * (t - a)) / (edges[k] - a))
  }
}

describe('scoreVibrato', () => {
  it('5.5 Hz ±30 cents (60 cents p-p) → detected with a high score', () => {
    const r = vib([{ start: 0.2, dur: 2, midi: 67, cents: sine(5.5, 30) }])
    expect(r.detectedCount).toBe(1)
    expect(r.rateHz).toBeCloseTo(5.5, 1)
    expect(r.extentCents).toBeGreaterThan(55)
    expect(r.extentCents).toBeLessThan(62)
    expect(r.periodCv).toBeLessThan(0.05)
    expect(r.score as number).toBeGreaterThanOrEqual(95)
  })

  it('finds delayed vibrato after a straight onset', () => {
    const late = (t: number) => (t < 0.7 ? 0 : sine(5.5, 30)(t - 0.7))
    const r = vib([{ start: 0, dur: 2.2, midi: 64, cents: late }])
    expect(r.detectedCount).toBe(1)
    expect(r.perNote[0].start).toBeGreaterThan(0.6)
    expect(r.score as number).toBeGreaterThan(90)
  })

  it('too fast / too wide vibrato scores lower', () => {
    const fast = vib([{ start: 0, dur: 2, midi: 64, cents: sine(8.5, 30) }])
    expect(fast.rateHz).toBeCloseTo(8.5, 0)
    expect(fast.score as number).toBeLessThan(80)
    const wide = vib([{ start: 0, dur: 2, midi: 64, cents: sine(5.5, 80) }])
    expect(wide.extentCents).toBeGreaterThan(150)
    expect(wide.score as number).toBeLessThan(80)
  })

  it('chaotic periods lower the regularity sub-score', () => {
    const fulls = [0.12, 0.28, 0.14, 0.3, 0.13, 0.26, 0.12, 0.29]
    const halves = fulls.flatMap((p) => [p / 2, p / 2])
    const r = vib([{ start: 0, dur: 2, midi: 64, cents: halfCycles(halves, 30) }])
    expect(r.detectedCount).toBe(1)
    expect(r.perNote[0].periodCv).toBeGreaterThan(0.18)
    expect(r.perNote[0].regularityScore).toBeLessThan(50)
    expect(r.score as number).toBeLessThan(85)
  })

  it('no vibrato (straight tone with small jitter) → null', () => {
    const rnd = lcg(7)
    const jitter = () => 2 * rnd()
    const r = vib([
      { start: 0, dur: 2, midi: 64, cents: jitter },
      { start: 2.5, dur: 1.5, midi: 67, cents: (t) => -10 + 8 * t },
    ])
    expect(r.detectedCount).toBe(0)
    expect(r.score).toBeNull()
  })

  it('no vibrato → total is unaffected (weighted mean of the other items)', () => {
    const specs = [...scaleNotes(12, { cents: -30 }), { start: 7, dur: 2, midi: 60 }]
    const { scores } = scoreFeatures(buildFeatures(specs), null)
    expect(scores.vibrato).toBeNull()
    expect(scores.rhythm).toBeNull()
    expect(scores.breath).not.toBeNull()
    const expected = Math.round(((scores.pitch as number) * 0.4 + (scores.breath as number) * 0.2) / 0.6)
    expect(scores.total).toBe(expected)
  })
})
