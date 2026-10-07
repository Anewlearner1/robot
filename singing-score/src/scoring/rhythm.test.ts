import { describe, expect, it } from 'vitest'
import { gridDeviation, scoreRhythm, trimmedMean } from './rhythm'

/** Onsets on an eighth grid at `bpm`, using a pseudo-random subset of grid points. */
function gridOnsets(bpm: number, phase: number, count: number): number[] {
  const g = 60 / bpm / 2
  const out: number[] = []
  let k = 0
  for (let i = 0; out.length < count; i++) {
    k += 1 + (i % 3) // skip some grid points: steps of 1, 2, 3 eighths
    out.push(phase + k * g)
  }
  return out
}

describe('gridDeviation', () => {
  it('returns signed distance to the nearest grid point', () => {
    expect(gridDeviation(1.05, 0.5, 0)).toBeCloseTo(0.05)
    expect(gridDeviation(0.95, 0.5, 0)).toBeCloseTo(-0.05)
    expect(gridDeviation(0.2, 0.5, 0.15)).toBeCloseTo(0.05)
  })
  it('trimmedMean drops the largest values', () => {
    expect(trimmedMean([1, 1, 1, 1, 1, 1, 1, 1, 1, 100], 0.1)).toBe(1)
  })
})

describe('scoreRhythm', () => {
  it('onsets exactly on the grid with an arbitrary phase → 100', () => {
    for (const [bpm, phase] of [
      [100, 0.137],
      [72, 1.913],
      [128, 0.0],
    ]) {
      const r = scoreRhythm(gridOnsets(bpm, phase, 24), bpm)
      expect(r.score).toBe(100)
      expect(r.meanDevMs).toBeLessThan(2)
    }
  })

  it('±75 ms jitter → ≈ 50', () => {
    const signs = [1, -1, -1, 1, 1, -1, 1, -1, -1, 1, -1, 1, 1, -1, -1, 1]
    const onsets = gridOnsets(60, 0.42, 16).map((t, i) => t + 0.075 * signs[i])
    const r = scoreRhythm(onsets, 60)
    expect(r.score).not.toBeNull()
    // 10% trimming lets the phase search shave a little off a symmetric ±75 ms pattern
    expect(r.score as number).toBeGreaterThan(43)
    expect(r.score as number).toBeLessThan(58)
  })

  it('a constant lag is absorbed by the unknown grid phase', () => {
    expect(scoreRhythm(gridOnsets(90, 0, 16).map((t) => t + 0.08), 90).score).toBe(100)
  })

  it('bpm null → null (未評)', () => {
    expect(scoreRhythm(gridOnsets(100, 0, 20), null).score).toBeNull()
  })

  it('fewer than 8 onsets → null', () => {
    expect(scoreRhythm(gridOnsets(100, 0, 7), 100).score).toBeNull()
    expect(scoreRhythm(gridOnsets(100, 0, 8), 100).score).toBe(100)
  })

  it('a fixed phase can be reused (local windows)', () => {
    const r = scoreRhythm([0.29, 0.59, 0.89], 100, undefined, { offsetSec: 0, minOnsets: 3 })
    expect(r.meanSignedMs).toBeCloseTo(-10, 5)
    expect(r.score).toBe(100)
  })
})
