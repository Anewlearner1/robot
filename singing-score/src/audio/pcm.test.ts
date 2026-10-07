import { describe, expect, it } from 'vitest'
import { ChunkBatcher, computeLevel, downmixToMono, PcmAccumulator, secondsToSamples } from './pcm'

describe('computeLevel', () => {
  it('silence → 0', () => {
    expect(computeLevel(new Float32Array(128))).toEqual({ rms: 0, peak: 0 })
    expect(computeLevel(new Float32Array(0))).toEqual({ rms: 0, peak: 0 })
  })
  it('full-scale sine → rms ≈ 0.707, peak ≈ 1', () => {
    const n = 4800
    const x = Float32Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * 440 * i) / 48000))
    const { rms, peak } = computeLevel(x)
    expect(rms).toBeCloseTo(Math.SQRT1_2, 3)
    expect(peak).toBeCloseTo(1, 3)
  })
  it('uses absolute values for peak and clamps to 1', () => {
    expect(computeLevel(Float32Array.of(0.1, -0.5, 0.2)).peak).toBeCloseTo(0.5)
    const loud = computeLevel(Float32Array.of(1.5, -1.5))
    expect(loud).toEqual({ rms: 1, peak: 1 })
  })
  it('constant DC → rms = |value|', () => {
    expect(computeLevel(new Float32Array(100).fill(-0.25)).rms).toBeCloseTo(0.25)
  })
})

describe('downmixToMono', () => {
  it('mono is passed through without copy', () => {
    const a = Float32Array.of(1, 2)
    expect(downmixToMono([a])).toBe(a)
  })
  it('averages stereo', () => {
    expect(Array.from(downmixToMono([Float32Array.of(1, 0, -1), Float32Array.of(0, 0, 1)]))).toEqual([0.5, 0, 0])
  })
  it('handles no channels and unequal lengths', () => {
    expect(downmixToMono([]).length).toBe(0)
    expect(downmixToMono([Float32Array.of(1, 1, 1), Float32Array.of(1)]).length).toBe(1)
  })
})

describe('PcmAccumulator', () => {
  it('accumulates chunks in order', () => {
    const acc = new PcmAccumulator(100)
    acc.push(Float32Array.of(1, 2, 3))
    acc.push([4, 5])
    expect(acc.length).toBe(5)
    expect(Array.from(acc.take())).toEqual([1, 2, 3, 4, 5])
    expect(acc.length).toBe(0)
  })
  it('grows from the initial capacity by doubling, never past max', () => {
    const acc = new PcmAccumulator(1000, 100)
    expect(acc.capacity).toBe(100)
    acc.push(new Float32Array(150))
    expect(acc.capacity).toBe(200)
    acc.push(new Float32Array(700))
    expect(acc.capacity).toBe(1000)
    expect(acc.length).toBe(850)
  })
  it('cuts off at maxSamples and reports full', () => {
    const acc = new PcmAccumulator(10, 4)
    expect(acc.push(new Float32Array(6).fill(1))).toBe(6)
    expect(acc.full).toBe(false)
    expect(acc.push(new Float32Array(6).fill(2))).toBe(4)
    expect(acc.full).toBe(true)
    expect(acc.push(new Float32Array(6))).toBe(0)
    const out = acc.take()
    expect(Array.from(out)).toEqual([1, 1, 1, 1, 1, 1, 2, 2, 2, 2])
  })
  it('take() returns an array that owns its exact-length buffer (transferable)', () => {
    const acc = new PcmAccumulator(1000, 64)
    acc.push(new Float32Array(10))
    const out = acc.take()
    expect(out.length).toBe(10)
    expect(out.buffer.byteLength).toBe(40)
    expect(out.byteOffset).toBe(0)
  })
  it('take() hands over the buffer without copying when exactly full', () => {
    const acc = new PcmAccumulator(8, 8)
    acc.push(new Float32Array(8).fill(3))
    const out = acc.take()
    expect(out.buffer.byteLength).toBe(32)
    expect(out[7]).toBe(3)
  })
  it('3-minute cap at 48 kHz', () => {
    const max = secondsToSamples(180, 48000)
    expect(max).toBe(8_640_000)
    const acc = new PcmAccumulator(max, secondsToSamples(30, 48000))
    const chunk = new Float32Array(2048)
    let pushes = 0
    while (!acc.full) {
      acc.push(chunk)
      pushes++
    }
    expect(acc.length).toBe(max)
    expect(pushes).toBe(Math.ceil(max / 2048))
  })
  it('reset() drops data', () => {
    const acc = new PcmAccumulator(10)
    acc.push(new Float32Array(5))
    acc.reset()
    expect(acc.length).toBe(0)
    expect(acc.take().length).toBe(0)
  })
  it('rejects invalid max', () => {
    expect(() => new PcmAccumulator(-1)).toThrow(RangeError)
  })
})

describe('ChunkBatcher', () => {
  it('batches 128-frame quanta into fixed chunks and flushes the tail', () => {
    const b = new ChunkBatcher(300)
    const out: Float32Array[] = []
    let v = 0
    for (let q = 0; q < 5; q++) {
      const quantum = Float32Array.from({ length: 128 }, () => v++)
      b.add(quantum, (c) => out.push(c))
    }
    expect(out.map((c) => c.length)).toEqual([300, 300])
    b.flush((c) => out.push(c))
    expect(out.map((c) => c.length)).toEqual([300, 300, 40])
    const all = out.flatMap((c) => Array.from(c))
    expect(all).toEqual(Array.from({ length: 640 }, (_, i) => i))
    b.flush((c) => out.push(c)) // nothing left
    expect(out.length).toBe(3)
  })
  it('emitted chunks are not reused afterwards', () => {
    const b = new ChunkBatcher(2)
    const out: Float32Array[] = []
    b.add(Float32Array.of(1, 2, 3, 4), (c) => out.push(c))
    expect(out.map((c) => Array.from(c))).toEqual([
      [1, 2],
      [3, 4],
    ])
  })
})
