import { describe, expect, it } from 'vitest'
import { scoreFeatures, totalScore } from './index'
import { buildFeatures } from './testFixtures'

describe('totalScore', () => {
  it('weights only scored items', () => {
    expect(totalScore({ pitch: 80, rhythm: null, breath: 60, vibrato: null })).toBe(Math.round((0.4 * 80 + 0.2 * 60) / 0.6))
    expect(totalScore({ pitch: 80, rhythm: 50, breath: 60, vibrato: 100 })).toBe(Math.round(0.4 * 80 + 0.2 * 50 + 0.2 * 60 + 0.2 * 100))
    expect(totalScore({ pitch: null, rhythm: 40, breath: null, vibrato: null })).toBe(40)
  })
  it('nothing scored → null', () => {
    expect(totalScore({ pitch: null, rhythm: null, breath: null, vibrato: null })).toBeNull()
  })
})

describe('scoreFeatures', () => {
  it('empty recording → all 未評, no issues', () => {
    const r = scoreFeatures(buildFeatures([], { duration: 5 }), 100)
    expect(r.scores).toEqual({ total: null, pitch: null, rhythm: null, breath: null, vibrato: null })
    expect(r.issues).toEqual([])
  })
  it('returns integer scores', () => {
    const specs = Array.from({ length: 12 }, (_, i) => ({ start: i * 0.6, dur: 0.5, midi: 60, cents: () => -17 }))
    const { scores } = scoreFeatures(buildFeatures(specs), 100)
    for (const v of Object.values(scores)) if (v !== null) expect(Number.isInteger(v)).toBe(true)
  })
})
