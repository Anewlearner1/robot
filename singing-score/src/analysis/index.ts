import type { AnalysisFeatures, PitchFrame } from '../types'
import { ANALYSIS_CONFIG, type AnalysisConfig } from './config'
import { detectKey } from './key'
import { segmentNotes } from './notes'
import { trackPitch } from './track'
import { cleanPitch, midiToHz } from './voicing'

export { ANALYSIS_CONFIG, type AnalysisConfig } from './config'
export { detectKey, keyLabel, FALLBACK_LABEL } from './key'
export { hzToMidi, midiToHz } from './voicing'

/**
 * Analysis engine entry point.
 *
 * Mono PCM → 10 ms frames (pitch via McLeod / pitchy on audio decimated to ≈16–22 kHz, RMS on the
 * original signal) → voicing + octave/spike cleanup → note segmentation → onsets → key.
 *
 * Frame i is centred at t = i * hopSec (frames are zero-padded at the edges).
 * Unvoiced frames have hz = null but keep their raw clarity and rms.
 * Onsets are the note start times (see notes.ts for the RMS-dip re-articulation split).
 */
export function extractFeatures(
  samples: Float32Array,
  sampleRate: number,
  config: Partial<AnalysisConfig> = {},
): AnalysisFeatures {
  const cfg: AnalysisConfig = { ...ANALYSIS_CONFIG, ...config }
  if (!(sampleRate > 0) || !Number.isFinite(sampleRate)) throw new Error(`invalid sampleRate ${sampleRate}`)

  const track = trackPitch(samples, sampleRate, cfg)
  const midi = cleanPitch(track, cfg)

  const frames: PitchFrame[] = new Array(track.count)
  for (let i = 0; i < track.count; i++) {
    const m = midi[i]
    frames[i] = {
      t: +(i * track.hopSec).toFixed(5),
      hz: Number.isNaN(m) ? null : midiToHz(m),
      clarity: track.clarity[i],
      rms: track.rms[i],
    }
  }

  const durationSec = samples.length / sampleRate
  const notes = segmentNotes(midi, track.rms, track.hopSec, cfg)
  for (const n of notes) n.end = Math.min(n.end, durationSec)
  const onsets = notes.map((n) => n.start).sort((a, b) => a - b)
  const key = detectKey(notes, cfg)

  return {
    sampleRate,
    durationSec,
    hopSec: track.hopSec,
    frames,
    notes,
    key,
    onsets,
  }
}
