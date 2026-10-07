import { describe, expect, it } from 'vitest'
import { scoreBreath } from './breath'
import { buildFeatures, sine, type NoteSpec } from './testFixtures'

const long = (start: number, extra: Partial<NoteSpec> = {}): NoteSpec => ({ start, dur: 2, midi: 67, ...extra })
const score = (specs: NoteSpec[]) => {
  const f = buildFeatures(specs)
  return scoreBreath(f, f.notes)
}

describe('scoreBreath', () => {
  it('steady long notes → 100', () => {
    const r = score([long(0.2), long(2.5), long(5)])
    expect(r.score).toBe(100)
    expect(r.cv).toBeCloseTo(0, 5)
  })

  it('vibrato is filtered out before measuring drift', () => {
    const r = score([long(0.2, { cents: sine(5.5, 30) }), long(2.5, { cents: sine(6.2, 40) })])
    expect(r.absDriftCentsPerSec).toBeLessThan(2)
    expect(r.score as number).toBeGreaterThan(95)
  })

  it('RMS swinging ~40% → low (volume sub-score ≈ 0)', () => {
    const swing = (t: number) => 0.2 * (1 + 0.4 * Math.SQRT2 * Math.sin(2 * Math.PI * 1.3 * t))
    const r = score([long(0.2, { rms: swing }), long(2.5, { rms: swing })])
    expect(r.cv).toBeGreaterThan(0.33)
    expect(r.perNote.every((n) => n.cvScore < 25)).toBe(true)
    expect(r.score as number).toBeLessThanOrEqual(62)
  })

  it('RMS swing plus 30 cents/s pitch sag → near 0', () => {
    const swing = (t: number) => 0.2 * (1 + 0.6 * Math.sin(2 * Math.PI * 1.3 * t))
    const r = score([long(0.2, { rms: swing, cents: (t) => 25 - 30 * t }), long(2.5, { rms: swing, cents: (t) => 25 - 30 * t })])
    expect(r.perNote[0].driftCentsPerSec).toBeCloseTo(-30, 0)
    expect(r.score as number).toBeLessThan(10)
  })

  it('no long notes → null (未評)', () => {
    const r = score([{ start: 0, dur: 0.7, midi: 60 }, { start: 1, dur: 0.5, midi: 62 }])
    expect(r.score).toBeNull()
  })
})
