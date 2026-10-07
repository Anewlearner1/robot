import type { AnalysisConfig } from './config'
import type { RawTrack } from './track'

export function hzToMidi(hz: number): number {
  return 69 + 12 * Math.log2(hz / 440)
}

export function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12)
}

/** Median of the first `len` entries of `scratch` (sorted in place, insertion sort: small n). */
export function medianInPlace(scratch: Float64Array, len: number): number {
  for (let i = 1; i < len; i++) {
    const v = scratch[i]
    let j = i - 1
    while (j >= 0 && scratch[j] > v) {
      scratch[j + 1] = scratch[j]
      j--
    }
    scratch[j + 1] = v
  }
  const mid = len >> 1
  return len % 2 === 1 ? scratch[mid] : (scratch[mid - 1] + scratch[mid]) / 2
}

/** Value at quantile q (0–1) of an array (copies). */
export function quantile(values: ArrayLike<number>, q: number): number {
  const arr = Float64Array.from(values).sort()
  if (arr.length === 0) return 0
  const pos = Math.min(arr.length - 1, Math.max(0, q * (arr.length - 1)))
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return arr[lo] + (arr[hi] - arr[lo]) * (pos - lo)
}

/**
 * Decide which frames are voiced and clean up the pitch curve.
 * Returns fractional MIDI per frame, NaN for unvoiced.
 *
 * 1. Gate on clarity, RMS (absolute + relative to the recording's P95) and Hz range.
 * 2. Octave correction against the median of voiced neighbours (±octaveNeighbourSec):
 *    frames ≥ 9 semitones away are shifted by ±12 if that lands within 2 semitones, else dropped.
 * 3. Single-frame spike removal: a frame > 1.5 semitones off while its two neighbours agree
 *    (< 1 semitone) is replaced by their mean.
 * 4. Voiced runs shorter than minVoicedRunSec are dropped.
 */
export function cleanPitch(track: RawTrack, cfg: AnalysisConfig): Float64Array {
  const { count, hz, clarity, rms, hopSec, rmsGate } = track
  const midi = new Float64Array(count).fill(NaN)
  if (count === 0) return midi

  for (let i = 0; i < count; i++) {
    const f = hz[i]
    if (clarity[i] >= cfg.minClarity && rms[i] >= rmsGate && f >= cfg.minHz && f <= cfg.maxHz) {
      midi[i] = hzToMidi(f)
    }
  }

  // Octave correction.
  const K = Math.max(1, Math.round(cfg.octaveNeighbourSec / hopSec))
  const scratch = new Float64Array(2 * K + 1)
  const corrected = new Float64Array(midi)
  for (let i = 0; i < count; i++) {
    const m = midi[i]
    if (Number.isNaN(m)) continue
    let len = 0
    for (let j = Math.max(0, i - K); j <= Math.min(count - 1, i + K); j++) {
      const v = midi[j]
      if (!Number.isNaN(v)) scratch[len++] = v
    }
    if (len < 3) continue
    const ref = medianInPlace(scratch, len)
    const d = m - ref
    if (Math.abs(d) >= 9) {
      const shifted = m - 12 * Math.round(d / 12)
      corrected[i] = Math.abs(shifted - ref) <= 2 ? shifted : NaN
    }
  }
  midi.set(corrected)

  // Single-frame spike removal.
  for (let i = 1; i < count - 1; i++) {
    const a = midi[i - 1]
    const b = midi[i + 1]
    const m = midi[i]
    if (Number.isNaN(a) || Number.isNaN(b) || Number.isNaN(m)) continue
    if (Math.abs(a - b) < 1) {
      const mean = (a + b) / 2
      if (Math.abs(m - mean) > 1.5) midi[i] = mean
    }
  }

  // Drop short isolated voiced runs.
  const minRun = Math.max(1, Math.round(cfg.minVoicedRunSec / hopSec))
  let runStart = -1
  for (let i = 0; i <= count; i++) {
    const voiced = i < count && !Number.isNaN(midi[i])
    if (voiced && runStart < 0) runStart = i
    else if (!voiced && runStart >= 0) {
      if (i - runStart < minRun) for (let j = runStart; j < i; j++) midi[j] = NaN
      runStart = -1
    }
  }
  return midi
}
