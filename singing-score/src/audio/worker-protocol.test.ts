import { describe, expect, it, vi } from 'vitest'
import type { AnalysisReport } from '../types'
import { handleMessage } from './worker-protocol'

const report = { durationSec: 1, bpm: 100 } as unknown as AnalysisReport

describe('handleMessage', () => {
  it('runs analyze and wraps the report', () => {
    const analyze = vi.fn(() => report)
    const samples = new Float32Array(10)
    const res = handleMessage({ samples, sampleRate: 48000, bpm: 100 }, analyze)
    expect(res).toEqual({ ok: true, report })
    expect(analyze).toHaveBeenCalledWith(samples, 48000, 100)
  })
  it('passes bpm null through', () => {
    const analyze = vi.fn(() => report)
    handleMessage({ samples: new Float32Array(1), sampleRate: 44100, bpm: null }, analyze)
    expect(analyze).toHaveBeenCalledWith(expect.any(Float32Array), 44100, null)
  })
  it('reports thrown errors instead of throwing', () => {
    const res = handleMessage({ samples: new Float32Array(1), sampleRate: 44100, bpm: null }, () => {
      throw new Error('boom')
    })
    expect(res).toEqual({ ok: false, error: 'boom' })
    expect(handleMessage({ samples: new Float32Array(1), sampleRate: 1, bpm: null }, () => {
      throw 'str'
    })).toEqual({ ok: false, error: 'str' })
  })
  it.each([
    [null],
    ['x'],
    [{ samples: [1, 2], sampleRate: 48000, bpm: null }],
    [{ samples: new Float32Array(1), sampleRate: 0, bpm: null }],
    [{ samples: new Float32Array(1), sampleRate: Number.NaN, bpm: null }],
    [{ samples: new Float32Array(1), sampleRate: 48000, bpm: -5 }],
    [{ samples: new Float32Array(1), sampleRate: 48000 }],
  ])('rejects malformed request %#', (msg) => {
    const analyze = vi.fn(() => report)
    const res = handleMessage(msg, analyze)
    expect(res.ok).toBe(false)
    expect(analyze).not.toHaveBeenCalled()
  })
})
