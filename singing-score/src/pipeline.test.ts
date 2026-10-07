import { describe, expect, it } from 'vitest'
import { summarizePitch } from './pipeline'

describe('summarizePitch', () => {
  it('bins frames to 50 ms and converts Hz to MIDI', () => {
    const pts = summarizePitch(
      [
        { t: 0.01, hz: 440 },
        { t: 0.06, hz: null },
      ],
      0.1,
    )
    expect(pts).toEqual([
      { t: 0, midi: 69 },
      { t: 0.05, midi: null },
    ])
  })
})
