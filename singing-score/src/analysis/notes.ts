import type { Note } from '../types'
import type { AnalysisConfig } from './config'
import { medianInPlace, quantile } from './voicing'

/**
 * Note segmentation (PRD 音符切分).
 *
 * - Voiced frames separated by unvoiced gaps ≤ maxBridgeSec form a "run".
 * - Inside a run the pitch is median-filtered over ≈1 vibrato period (smoothingSec). A median keeps
 *   real steps sharp while flattening vibrato, so a sustained note with ±40–100 cent vibrato stays
 *   one note but a ≥ 1 semitone step splits immediately.
 * - Frames are appended to the current note while the smoothed pitch stays within
 *   noteToleranceCents of the note's running mean; a new note starts when the deviation persists
 *   (same side) for noteBreakConfirmSec, so residual vibrato wobble does not split a note.
 * - Candidates shorter than minNoteSec, or whose smoothed pitch drifts by more than
 *   maxNoteDriftCents between their first and second half (glides / runs), are discarded.
 * - Re-articulated same-pitch notes are split at deep RMS dips (onsetDipRatio).
 * - Note.midi = median of the (cleaned, unsmoothed) fractional MIDI of its voiced frames.
 */
export function segmentNotes(midi: Float64Array, rms: Float64Array, hopSec: number, cfg: AnalysisConfig): Note[] {
  const count = midi.length
  const notes: Note[] = []
  if (count === 0) return notes

  const maxBridge = Math.max(0, Math.round(cfg.maxBridgeSec / hopSec))
  const H = Math.max(1, Math.round(cfg.smoothingSec / hopSec / 2))
  const minLen = Math.max(1, Math.round(cfg.minNoteSec / hopSec - 1e-9))
  const tol = cfg.noteToleranceCents / 100
  const maxDrift = cfg.maxNoteDriftCents / 100
  const dipW = Math.max(1, Math.round(cfg.onsetDipWindowSec / hopSec))
  const confirm = Math.max(1, Math.round(cfg.noteBreakConfirmSec / hopSec))

  const smooth = new Float64Array(count).fill(NaN)
  const scratch = new Float64Array(2 * H + 1)

  const emit = (a: number, b: number): void => {
    // Trim to voiced frames.
    while (a < b && Number.isNaN(midi[a])) a++
    while (b > a && Number.isNaN(midi[b - 1])) b--
    if (b - a < minLen) return
    const vals: number[] = []
    for (let i = a; i < b; i++) if (!Number.isNaN(midi[i])) vals.push(midi[i])
    const med = quantile(vals, 0.5)
    notes.push({
      start: Math.max(0, a * hopSec - hopSec / 2),
      end: (b - 1) * hopSec + hopSec / 2,
      midi: med,
      frameStart: a,
      frameEnd: b,
    })
  }

  const finalize = (a: number, b: number): void => {
    if (b - a < minLen) return
    // Glide rejection: compare the smoothed pitch of the first and second half of the candidate.
    // A glide/run has a monotonic trend; vibrato residue and natural wobble average out.
    const sv: number[] = []
    for (let i = a; i < b; i++) if (!Number.isNaN(smooth[i])) sv.push(smooth[i])
    const halfLen = sv.length >> 1
    if (halfLen > 0) {
      const drift = quantile(sv.slice(sv.length - halfLen), 0.5) - quantile(sv.slice(0, halfLen), 0.5)
      if (Math.abs(drift) > maxDrift) return
    }

    // Split at deep RMS dips (same-pitch re-articulation).
    let pieceStart = a
    for (let k = a + minLen; k <= b - minLen; k++) {
      if (k - pieceStart < minLen) continue
      const r = rms[k]
      if (r > rms[k - 1] || r > rms[k + 1]) continue
      let before = 0
      for (let j = Math.max(pieceStart, k - dipW); j < k; j++) if (rms[j] > before) before = rms[j]
      let after = 0
      for (let j = k + 1; j <= Math.min(b - 1, k + dipW); j++) if (rms[j] > after) after = rms[j]
      if (r < cfg.onsetDipRatio * Math.min(before, after)) {
        emit(pieceStart, k)
        pieceStart = k
        k += minLen - 1
      }
    }
    emit(pieceStart, b)
  }

  /** True when the next `confirm` voiced frames from k all deviate > tol on the same side. */
  const deviationPersists = (k: number, end: number, centre: number): boolean => {
    const sign = Math.sign(smooth[k] - centre)
    let seen = 0
    for (let q = k; q < end && seen < confirm; q++) {
      const v = smooth[q]
      if (Number.isNaN(v)) continue
      const d = v - centre
      if (Math.abs(d) <= tol || Math.sign(d) !== sign) return false
      seen++
    }
    return true
  }

  let i = 0
  while (i < count) {
    if (Number.isNaN(midi[i])) {
      i++
      continue
    }
    // Find bridged run [rs, re).
    const rs = i
    let last = i
    let j = i + 1
    while (j < count) {
      if (!Number.isNaN(midi[j])) {
        last = j
        j++
      } else if (j - last <= maxBridge) {
        j++
      } else break
    }
    const re = last + 1

    // Median-smooth inside the run.
    for (let k = rs; k < re; k++) {
      if (Number.isNaN(midi[k])) continue
      let len = 0
      // Shift (not truncate) the window at run edges so it still spans ≈1 vibrato period.
      let lo = k - H
      let hi = k + H
      if (lo < rs) {
        hi += rs - lo
        lo = rs
      }
      if (hi > re - 1) {
        lo -= hi - (re - 1)
        hi = re - 1
      }
      if (lo < rs) lo = rs
      for (let q = lo; q <= hi; q++) if (!Number.isNaN(midi[q])) scratch[len++] = midi[q]
      smooth[k] = medianInPlace(scratch, len)
    }

    // Running-centre segmentation.
    let segStart = -1
    let segLast = -1
    let sum = 0
    let cnt = 0
    for (let k = rs; k < re; k++) {
      const s = smooth[k]
      if (Number.isNaN(s)) continue
      if (cnt > 0 && Math.abs(s - sum / cnt) > tol && deviationPersists(k, re, sum / cnt)) {
        finalize(segStart, segLast + 1)
        cnt = 0
        sum = 0
      }
      if (cnt === 0) segStart = k
      sum += s
      cnt++
      segLast = k
    }
    if (cnt > 0) finalize(segStart, segLast + 1)
    i = re
  }

  return notes
}
