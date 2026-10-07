import { PitchDetector } from 'pitchy'
import type { AnalysisConfig } from './config'
import { quantile } from './voicing'

/** Raw per-frame measurements in struct-of-arrays form (no per-frame objects in the hot loop). */
export interface RawTrack {
  /** Seconds between frames. Frame i is centred at i * hopSec. */
  hopSec: number
  count: number
  /** Detected f0 (Hz), 0 when the detector found nothing. */
  hz: Float64Array
  clarity: Float64Array
  rms: Float64Array
  /** Sample rate the pitch detector ran at, and its window length. */
  pitchSampleRate: number
  windowSize: number
  /** RMS silence gate actually used (max of absolute and relative gates). */
  rmsGate: number
}

/**
 * Low-pass (windowed sinc) + integer decimation + one-pole DC blocker (~30 Hz).
 * Outputs only every `factor`-th sample, so cost is O(len / factor * taps).
 */
export function decimate(input: Float32Array, factor: number, sampleRate: number): Float32Array {
  const outLen = Math.ceil(input.length / factor)
  const out = new Float32Array(outLen)
  const outRate = sampleRate / factor
  const r = Math.exp((-2 * Math.PI * 30) / outRate)

  if (factor === 1) {
    let x1 = 0
    let y1 = 0
    for (let i = 0; i < outLen; i++) {
      const x = input[i]
      const y = x - x1 + r * y1
      out[i] = y
      x1 = x
      y1 = y
    }
    return out
  }

  // Hamming-windowed sinc, cutoff 0.4 × output Nyquist·2 (i.e. 0.4/factor cycles/sample).
  const half = 4 * factor
  const taps = 2 * half + 1
  const h = new Float64Array(taps)
  const fc = 0.4 / factor
  let sum = 0
  for (let k = 0; k < taps; k++) {
    const m = k - half
    const sinc = m === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * m) / (Math.PI * m)
    const w = 0.54 - 0.46 * Math.cos((2 * Math.PI * k) / (taps - 1))
    h[k] = sinc * w
    sum += h[k]
  }
  for (let k = 0; k < taps; k++) h[k] /= sum

  const n = input.length
  let x1 = 0
  let y1 = 0
  for (let o = 0; o < outLen; o++) {
    const c = o * factor
    let acc = 0
    const lo = c - half
    if (lo >= 0 && c + half < n) {
      for (let k = 0; k < taps; k++) acc += h[k] * input[lo + k]
    } else {
      for (let k = 0; k < taps; k++) {
        const idx = lo + k
        if (idx >= 0 && idx < n) acc += h[k] * input[idx]
      }
    }
    const y = acc - x1 + r * y1
    out[o] = y
    x1 = acc
    y1 = y
  }
  return out
}

function nextPow2(v: number): number {
  let p = 1
  while (p < v) p <<= 1
  return p
}

/** Frame the signal (centred frames, zero padded at the edges) and run MPM + RMS per frame. */
export function trackPitch(samples: Float32Array, sampleRate: number, cfg: AnalysisConfig): RawTrack {
  const factor = Math.max(1, Math.floor(sampleRate / cfg.pitchSampleRateTarget))
  const sr = sampleRate / factor
  const hop = Math.max(1, Math.round(cfg.hopSec * sr))
  const hopSec = hop / sr
  const windowSize = nextPow2(Math.ceil(cfg.minWindowSec * sr))

  const x = decimate(samples, factor, sampleRate)
  const count = x.length === 0 ? 0 : Math.floor((x.length - 1) / hop) + 1

  const hz = new Float64Array(count)
  const clarity = new Float64Array(count)
  const rms = new Float64Array(count)
  if (count === 0) return { hopSec, count, hz, clarity, rms, pitchSampleRate: sr, windowSize, rmsGate: cfg.minRmsAbs }

  // ── RMS on the original-rate signal (full band), DC removed per window ──
  const rmsHalf = Math.max(1, Math.round((cfg.rmsWindowSec * sampleRate) / 2))
  const n = samples.length
  const hopOrig = hop * factor
  for (let i = 0; i < count; i++) {
    const c = i * hopOrig
    const a = Math.max(0, c - rmsHalf)
    const b = Math.min(n, c + rmsHalf)
    const len = b - a
    if (len <= 0) continue
    let s = 0
    let s2 = 0
    for (let k = a; k < b; k++) {
      const v = samples[k]
      s += v
      s2 += v * v
    }
    const mean = s / len
    const varr = s2 / len - mean * mean
    rms[i] = varr > 0 ? Math.sqrt(varr) : 0
  }
  const rmsGate = Math.max(cfg.minRmsAbs, cfg.minRmsRel * quantile(rms, 0.95))

  // ── Pitch (McLeod) — only on frames above the silence gate ──
  const detector = PitchDetector.forFloat32Array(windowSize)
  detector.minVolumeAbsolute = 0 // we gate on RMS ourselves
  const buf = new Float32Array(windowSize)
  const halfWin = windowSize >> 1
  const xLen = x.length
  const maxHz = cfg.maxHz * 1.5

  for (let i = 0; i < count; i++) {
    if (rms[i] < rmsGate) continue
    const start = i * hop - halfWin
    if (start >= 0 && start + windowSize <= xLen) {
      buf.set(x.subarray(start, start + windowSize))
    } else {
      for (let k = 0; k < windowSize; k++) {
        const idx = start + k
        buf[k] = idx >= 0 && idx < xLen ? x[idx] : 0
      }
    }
    const res = detector.findPitch(buf, sr)
    const f = res[0]
    if (Number.isFinite(f) && f > 0 && f <= maxHz) {
      hz[i] = f
      clarity[i] = Number.isFinite(res[1]) ? Math.max(0, res[1]) : 0
    }
  }

  return { hopSec, count, hz, clarity, rms, pitchSampleRate: sr, windowSize, rmsGate }
}
