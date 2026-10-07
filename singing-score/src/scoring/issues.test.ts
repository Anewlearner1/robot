import { describe, expect, it } from 'vitest'
import { scoreFeatures } from './index'
import { windowStarts } from './issues'
import { SONG_BPM, buildFeatures, songSpecs } from './testFixtures'

const overlaps = (a: { start: number; end: number }, s: number, e: number) => a.start < e && s < a.end

describe('windowStarts', () => {
  it('covers the recording with 3 s windows every 0.5 s', () => {
    expect(windowStarts(5)).toEqual([0, 0.5, 1, 1.5, 2])
    expect(windowStarts(2)).toEqual([0])
  })
})

describe('issues', () => {
  it('good recording → high scores and 0 issues', () => {
    const { scores, issues } = scoreFeatures(buildFeatures(songSpecs(14)), SONG_BPM)
    expect(scores.pitch).toBe(100)
    expect(scores.rhythm).toBe(100)
    expect(scores.breath).toBeGreaterThanOrEqual(95)
    expect(scores.vibrato).toBeGreaterThanOrEqual(90)
    expect(issues).toEqual([])
  })

  it('one badly flat 3 s region → an issue covering it, mentioning cents', () => {
    const specs = songSpecs(14, (s) => (s.start >= 21 && s.start < 24 ? { ...s, cents: () => -45 } : s))
    const { scores, issues } = scoreFeatures(buildFeatures(specs), SONG_BPM)
    expect(scores.pitch).toBeGreaterThanOrEqual(90)
    expect(issues).toHaveLength(1)
    const [is] = issues
    expect(is.type).toBe('pitch')
    expect(overlaps(is, 21, 24)).toBe(true)
    expect(is.start).toBeGreaterThanOrEqual(20.9)
    expect(is.message).toMatch(/^0:21 /)
    expect(is.message).toContain('cents')
    expect(is.message).toContain('偏低約 45 cents')
  })

  it('at most 3 issues, sorted by start time, non-overlapping', () => {
    const bad = new Set([1, 4, 6, 9, 12])
    const specs = songSpecs(14, (s, p, k) => (bad.has(p) && k < 4 ? { ...s, cents: () => (p % 2 ? 40 : -40) } : s))
    const { issues } = scoreFeatures(buildFeatures(specs), SONG_BPM)
    expect(issues).toHaveLength(3)
    for (let i = 1; i < issues.length; i++) {
      expect(issues[i].start).toBeGreaterThan(issues[i - 1].start)
      expect(issues[i].start).toBeGreaterThanOrEqual(issues[i - 1].end)
    }
    for (const is of issues) expect(is.message).toMatch(/偏(低|高)約 40 cents/)
  })

  it('late onsets in one phrase → rhythm issue in ms', () => {
    const specs = songSpecs(14, (s, p, k) => (p === 7 && k < 4 ? { ...s, start: s.start + 0.09 } : s))
    const { issues } = scoreFeatures(buildFeatures(specs), SONG_BPM)
    expect(issues).toHaveLength(1)
    expect(issues[0].type).toBe('rhythm')
    expect(issues[0].message).toMatch(/^0:29 起音比拍點晚約 90 ms/)
  })

  it('unsteady long note → breath issue with the CV percentage', () => {
    const swing = (t: number) => 0.2 * (1 + 0.6 * Math.sin(2 * Math.PI * 1.2 * t))
    const specs = songSpecs(14, (s, p, k) => (p === 10 && k === 4 ? { ...s, cents: undefined, rms: swing } : s))
    const { issues } = scoreFeatures(buildFeatures(specs), SONG_BPM)
    expect(issues).toHaveLength(1)
    expect(issues[0].type).toBe('breath')
    expect(issues[0].message).toMatch(/^0:44 長音音量起伏大（約 \d+%），試著穩定吐氣/)
  })

  it('no rhythm issues when bpm is null', () => {
    const specs = songSpecs(14, (s, p, k) => (p === 7 && k < 4 ? { ...s, start: s.start + 0.09 } : s))
    const { scores, issues } = scoreFeatures(buildFeatures(specs), null)
    expect(scores.rhythm).toBeNull()
    expect(issues.filter((i) => i.type === 'rhythm')).toEqual([])
  })
})
