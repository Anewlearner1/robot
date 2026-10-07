// Pure PCM helpers shared by the recorder (main thread) and the capture worklet.
// No DOM / Web Audio references here: this module is also bundled into the AudioWorklet.

export interface Level {
  /** Root-mean-square level, linear 0–1. */
  rms: number
  /** Absolute peak, linear 0–1 (clamped). */
  peak: number
}

/** RMS and peak of one chunk. Empty chunk → 0/0. */
export function computeLevel(chunk: ArrayLike<number>): Level {
  const n = chunk.length
  if (n === 0) return { rms: 0, peak: 0 }
  let sumSq = 0
  let peak = 0
  for (let i = 0; i < n; i++) {
    const v = chunk[i]
    sumSq += v * v
    const a = v < 0 ? -v : v
    if (a > peak) peak = a
  }
  const rms = Math.sqrt(sumSq / n)
  return { rms: Math.min(1, rms), peak: Math.min(1, peak) }
}

/**
 * Average all channels into one mono channel (equal weights, like Web Audio's
 * "speakers" stereo→mono down-mix). One channel → returned as-is (no copy).
 * Channels of unequal length are truncated to the shortest.
 */
export function downmixToMono(channels: readonly Float32Array[]): Float32Array {
  if (channels.length === 0) return new Float32Array(0)
  if (channels.length === 1) return channels[0]
  let n = channels[0].length
  for (const c of channels) n = Math.min(n, c.length)
  const out = new Float32Array(n)
  const k = channels.length
  for (const c of channels) {
    for (let i = 0; i < n; i++) out[i] += c[i]
  }
  for (let i = 0; i < n; i++) out[i] /= k
  return out
}

/** Initial capacity of the growing buffer, in seconds of audio. */
export const INITIAL_CAPACITY_SEC = 30

/**
 * Append-only mono PCM buffer with a hard cap (maxSamples). Grows by doubling
 * (starting at ~30 s) so short takes don't allocate the full 3-minute buffer.
 */
export class PcmAccumulator {
  readonly maxSamples: number
  private buf: Float32Array
  private len = 0

  constructor(maxSamples: number, initialCapacity?: number) {
    if (!Number.isFinite(maxSamples) || maxSamples < 0) throw new RangeError('maxSamples must be ≥ 0')
    this.maxSamples = Math.floor(maxSamples)
    const cap = initialCapacity ?? this.maxSamples
    this.buf = new Float32Array(Math.max(0, Math.min(this.maxSamples, Math.floor(cap))))
  }

  /** Samples stored so far. */
  get length(): number {
    return this.len
  }

  /** Allocated capacity (for tests / diagnostics). */
  get capacity(): number {
    return this.buf.length
  }

  /** True once maxSamples have been stored; further pushes are dropped. */
  get full(): boolean {
    return this.len >= this.maxSamples
  }

  /** Append a chunk; anything beyond maxSamples is cut off. Returns the number of samples accepted. */
  push(chunk: ArrayLike<number>): number {
    const take = Math.min(chunk.length, this.maxSamples - this.len)
    if (take <= 0) return 0
    this.ensureCapacity(this.len + take)
    if (take === chunk.length && chunk instanceof Float32Array) {
      this.buf.set(chunk, this.len)
    } else if (chunk instanceof Float32Array) {
      this.buf.set(chunk.subarray(0, take), this.len)
    } else {
      for (let i = 0; i < take; i++) this.buf[this.len + i] = chunk[i]
    }
    this.len += take
    return take
  }

  /**
   * Exact-length copy that owns its own ArrayBuffer (so it can be transferred
   * to a worker). When the buffer is exactly full the internal buffer is
   * handed over without copying and the accumulator is reset.
   */
  take(): Float32Array {
    let out: Float32Array
    if (this.len === this.buf.length) {
      out = this.buf
    } else {
      out = this.buf.slice(0, this.len)
    }
    this.buf = new Float32Array(0)
    this.len = 0
    return out
  }

  /** Drop all data and release memory. */
  reset(): void {
    this.buf = new Float32Array(0)
    this.len = 0
  }

  private ensureCapacity(needed: number): void {
    if (needed <= this.buf.length) return
    let cap = Math.max(this.buf.length, 1)
    while (cap < needed) cap *= 2
    cap = Math.min(cap, this.maxSamples)
    const next = new Float32Array(cap)
    next.set(this.buf.subarray(0, this.len))
    this.buf = next
  }
}

/** Number of samples for a duration at a given rate (rounded). */
export function secondsToSamples(sec: number, sampleRate: number): number {
  return Math.max(0, Math.round(sec * sampleRate))
}

/**
 * Collects fixed-size quanta (e.g. 128-frame render quanta) into larger chunks.
 * Used by the worklet so the main thread gets ~20–30 messages/s instead of ~375.
 */
export class ChunkBatcher {
  readonly chunkSize: number
  private cur: Float32Array
  private fill = 0

  constructor(chunkSize: number) {
    this.chunkSize = Math.max(1, Math.floor(chunkSize))
    this.cur = new Float32Array(this.chunkSize)
  }

  /** Add samples; calls emit(chunk) for each completed chunk (chunk ownership passes to emit). */
  add(samples: Float32Array, emit: (chunk: Float32Array) => void): void {
    let off = 0
    while (off < samples.length) {
      const n = Math.min(this.chunkSize - this.fill, samples.length - off)
      this.cur.set(samples.subarray(off, off + n), this.fill)
      this.fill += n
      off += n
      if (this.fill === this.chunkSize) {
        emit(this.cur)
        this.cur = new Float32Array(this.chunkSize)
        this.fill = 0
      }
    }
  }

  /** Emit the partial chunk (if any) as an exact-length array. */
  flush(emit: (chunk: Float32Array) => void): void {
    if (this.fill === 0) return
    emit(this.cur.slice(0, this.fill))
    this.fill = 0
  }
}
