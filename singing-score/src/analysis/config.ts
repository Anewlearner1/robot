/**
 * Tunable parameters of the analysis engine. Everything that may need calibration
 * against real recordings (milestone M2) lives here.
 */
export interface AnalysisConfig {
  // ── Framing ────────────────────────────────────────────────────────────────
  /** Target hop between frames, seconds (actual hop is rounded to whole samples). */
  hopSec: number
  /** Audio is decimated by floor(sampleRate / this) before pitch detection (never below it). */
  pitchSampleRateTarget: number
  /** Pitch window is the smallest power of two covering this many seconds (≈2.7 periods of 65 Hz). */
  minWindowSec: number
  /** RMS window length, seconds (centred on the frame time; DC removed). */
  rmsWindowSec: number

  // ── Voicing ────────────────────────────────────────────────────────────────
  /** Frames whose McLeod clarity is below this are unvoiced (PRD: 音高信心值過低的影格排除). */
  minClarity: number
  /** Absolute RMS silence gate (linear). */
  minRmsAbs: number
  /** Relative RMS gate: frames below this fraction of the 95th-percentile RMS are unvoiced. */
  minRmsRel: number
  /** Plausible singing range, Hz. */
  minHz: number
  maxHz: number
  /** Octave correction: neighbourhood half-width (s) for the reference median. */
  octaveNeighbourSec: number
  /** Voiced runs shorter than this (s) after cleanup are discarded as blips. */
  minVoicedRunSec: number

  // ── Note segmentation ──────────────────────────────────────────────────────
  /** Max deviation (cents) of the smoothed pitch from the running note centre. */
  noteToleranceCents: number
  /** A deviation beyond noteToleranceCents must persist this long (s, same side) to split a note. */
  noteBreakConfirmSec: number
  /** Minimum note length, seconds. */
  minNoteSec: number
  /** Median-filter length (s) used to smooth vibrato before segmentation (≈1 vibrato period). */
  smoothingSec: number
  /** Unvoiced gaps up to this long (s) inside a note are bridged. */
  maxBridgeSec: number
  /**
   * Candidates whose smoothed pitch moves more than this (cents) between the median of their
   * first half and of their second half are treated as glides and dropped.
   */
  maxNoteDriftCents: number
  /** RMS dip re-articulation split: dip must be below this ratio of the surrounding peaks. */
  onsetDipRatio: number
  /** Look-around window (s) for the RMS dip peaks. */
  onsetDipWindowSec: number

  // ── Key detection ──────────────────────────────────────────────────────────
  /** Fewer notes than this → fallback. */
  keyMinNotes: number
  /** Best Pearson correlation below this → fallback. */
  keyMinCorrelation: number
  /**
   * Best minus the best key that does not share the same diatonic collection
   * (i.e. excluding the relative major/minor) below this → fallback.
   */
  keyMinMargin: number
}

export const ANALYSIS_CONFIG: AnalysisConfig = {
  hopSec: 0.01,
  pitchSampleRateTarget: 11025,
  minWindowSec: 0.042,
  rmsWindowSec: 0.03,

  minClarity: 0.88,
  minRmsAbs: 0.002,
  minRmsRel: 0.03,
  minHz: 65,
  maxHz: 1100,
  octaveNeighbourSec: 0.07,
  minVoicedRunSec: 0.03,

  noteToleranceCents: 50,
  noteBreakConfirmSec: 0.04,
  minNoteSec: 0.1,
  smoothingSec: 0.19,
  maxBridgeSec: 0.04,
  maxNoteDriftCents: 40,
  onsetDipRatio: 0.35,
  onsetDipWindowSec: 0.1,

  keyMinNotes: 8,
  keyMinCorrelation: 0.5,
  keyMinMargin: 0.05,
}
