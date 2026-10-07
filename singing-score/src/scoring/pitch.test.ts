import { describe, expect, it } from 'vitest'
import type { KeyInfo, Note } from '../types'
import { scoringConfig } from './config'
import { allowedPitchClasses, deviationCents, scorePitch } from './pitch'
import { C_MAJOR, FALLBACK_KEY, buildFeatures, scaleNotes } from './testFixtures'

const notesOf = (specs: Parameters<typeof buildFeatures>[0]): Note[] => buildFeatures(specs).notes

describe('deviationCents', () => {
  it('measures signed distance to the nearest allowed pitch class', () => {
    const pcs = allowedPitchClasses(C_MAJOR)
    expect(deviationCents(60, pcs)).toBeCloseTo(0)
    expect(deviationCents(59.7, pcs)).toBeCloseTo(-30) // B4 is in C major → B + 70 or C − 30
    expect(deviationCents(61, pcs)).toBeCloseTo(100) // C# is equidistant from C and D
    expect(Math.abs(deviationCents(61, allowedPitchClasses(FALLBACK_KEY)))).toBeCloseTo(0)
  })

  it('minor scale includes the raised leading tone by default', () => {
    const aMinor: KeyInfo = { tonic: 9, mode: 'minor', confidence: 0.8, fallback: false, label: 'A 小調' }
    expect(deviationCents(68, allowedPitchClasses(aMinor))).toBeCloseTo(0) // G#
    const strict = { ...scoringConfig, pitch: { ...scoringConfig.pitch, minorIncludesLeadingTone: false } }
    expect(Math.abs(deviationCents(68, allowedPitchClasses(aMinor, strict)))).toBeCloseTo(100)
  })
})

describe('scorePitch', () => {
  it('perfectly in-tune notes → 100', () => {
    const r = scorePitch(notesOf(scaleNotes(12)), C_MAJOR)
    expect(r.score).toBe(100)
    expect(r.meanAbsCents).toBeCloseTo(0, 5)
  })

  it('notes 30 cents flat → ≈ 50', () => {
    const r = scorePitch(notesOf(scaleNotes(12, { cents: -30 })), C_MAJOR)
    expect(r.score).toBeCloseTo(50, 0)
    expect(r.meanSignedCents).toBeCloseTo(-30, 0)
  })

  it('weights deviation by note duration', () => {
    // 10 in-tune notes of 0.4 s + 2 notes 40 cents sharp of 2 s → mean abs dev = 160 / 8 = 20 cents
    const specs = [
      ...scaleNotes(10),
      { start: 6, dur: 2, midi: 60, cents: () => 40 },
      { start: 8.5, dur: 2, midi: 62, cents: () => 40 },
    ]
    const r = scorePitch(notesOf(specs), C_MAJOR)
    expect(r.meanAbsCents).toBeCloseTo((40 * 4) / (10 * 0.4 + 4), 1)
  })

  it('fewer than 10 valid notes → null (未評)', () => {
    expect(scorePitch(notesOf(scaleNotes(9)), C_MAJOR).score).toBeNull()
    expect(scorePitch(notesOf(scaleNotes(10)), C_MAJOR).score).toBe(100)
  })

  it('fallback key judges against the nearest semitone', () => {
    const chromatic = Array.from({ length: 12 }, (_, i) => ({ start: i * 0.5, dur: 0.4, midi: 61 + (i % 2) * 2 })) // C#, D#
    expect(scorePitch(notesOf(chromatic), FALLBACK_KEY).score).toBe(100)
    expect(scorePitch(notesOf(chromatic), C_MAJOR).score).toBe(0)
    const off = chromatic.map((s) => ({ ...s, cents: () => 20 }))
    expect(scorePitch(notesOf(off), FALLBACK_KEY).score).toBeCloseTo(75, 0)
  })

  it('optional tuning compensation forgives a consistent global offset', () => {
    const cfg = { ...scoringConfig, pitch: { ...scoringConfig.pitch, compensateTuning: true } }
    const r = scorePitch(notesOf(scaleNotes(12, { cents: -30 })), C_MAJOR, cfg)
    expect(r.tuningOffsetCents).toBeCloseTo(-30, 0)
    expect(r.score).toBe(100)
  })
})
