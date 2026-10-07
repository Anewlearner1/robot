import { describe, expect, it } from 'vitest'
import { createTapTempo } from './tapTempo'

function tapSeq(times: number[]) {
  const tt = createTapTempo()
  const results = times.map((t) => tt.tap(t))
  return { tt, results }
}

const evenly = (bpm: number, n: number, t0 = 1000) => Array.from({ length: n }, (_, i) => t0 + (i * 60000) / bpm)

describe('createTapTempo', () => {
  it('returns null until 4 taps, then the BPM', () => {
    const { results, tt } = tapSeq(evenly(120, 4))
    expect(results).toEqual([null, null, null, 120])
    expect(tt.count).toBe(4)
  })

  it('120 BPM taps → 120 for long sequences', () => {
    const { results } = tapSeq(evenly(120, 20))
    expect(results.slice(3).every((b) => b === 120)).toBe(true)
  })

  it.each([60, 72, 90, 100, 133, 175, 200])('steady %i BPM', (bpm) => {
    const { results } = tapSeq(evenly(bpm, 10))
    expect(results.at(-1)).toBe(bpm)
  })

  it('rounds to an integer', () => {
    // 500 ms ≈ 120, 480 ms = 125, median of [500, 480, 490] = 490 → 122.4 → 122
    expect(tapSeq([0, 500, 980, 1470]).results.at(-1)).toBe(122)
  })

  it('is robust to human jitter (±20 ms)', () => {
    const jitter = [0, 15, -12, 20, -18, 8, -5, 11, -20, 3, 17, -9]
    const times = jitter.map((j, i) => 1000 + i * 500 + j)
    expect(tapSeq(times).results.at(-1)).toBe(120)
  })

  it('median ignores a single outlier interval', () => {
    // one late tap (+200 ms) followed by an early one
    const times = [0, 500, 1000, 1500, 2200, 2500, 3000, 3500]
    expect(tapSeq(times).results.at(-1)).toBe(120)
  })

  it('uses only the last ≤ 8 intervals (tempo change converges)', () => {
    const slow = evenly(60, 6, 0) // 0..5000
    const fastStart = slow.at(-1)! + 500
    const fast = evenly(120, 9, fastStart) // 9 taps → with the last slow tap: 9 intervals of 500
    const { results } = tapSeq([...slow, ...fast])
    expect(results.at(-1)).toBe(120)
  })

  it('a pause > 2 s restarts the sequence', () => {
    const tt = createTapTempo()
    for (const t of evenly(120, 5, 0)) tt.tap(t)
    expect(tt.count).toBe(5)
    expect(tt.tap(2000 + 2001)).toBeNull() // 2001 ms after last tap (2000)
    expect(tt.count).toBe(1)
    expect(tt.tap(4001 + 750)).toBeNull()
    expect(tt.tap(4001 + 1500)).toBeNull()
    expect(tt.tap(4001 + 2250)).toBe(80)
  })

  it('an interval of exactly 2 s does not restart (30 BPM → clamped to 40)', () => {
    const { results, tt } = tapSeq([0, 2000, 4000, 6000])
    expect(tt.count).toBe(4)
    expect(results.at(-1)).toBe(40) // 30 BPM clamped
  })

  it('clamps to 240 max', () => {
    expect(tapSeq(evenly(400, 6)).results.at(-1)).toBe(240)
  })

  it('clamps to 40 min', () => {
    expect(tapSeq(evenly(35, 6)).results.at(-1)).toBe(40)
  })

  it('ignores duplicate / non-increasing timestamps', () => {
    const tt = createTapTempo()
    tt.tap(0)
    tt.tap(500)
    tt.tap(500)
    tt.tap(400)
    expect(tt.count).toBe(2)
    tt.tap(1000)
    expect(tt.tap(1500)).toBe(120)
  })

  it('reset() clears the sequence', () => {
    const tt = createTapTempo()
    for (const t of evenly(120, 6)) tt.tap(t)
    tt.reset()
    expect(tt.count).toBe(0)
    expect(tt.tap(100000)).toBeNull()
    expect(tt.count).toBe(1)
  })

  it('count keeps growing beyond the 8-interval window', () => {
    const { tt } = tapSeq(evenly(100, 15))
    expect(tt.count).toBe(15)
  })

  it('defaults to performance.now() when no time is given', () => {
    const tt = createTapTempo()
    expect(tt.tap()).toBeNull()
    expect(tt.count).toBe(1)
  })
})
