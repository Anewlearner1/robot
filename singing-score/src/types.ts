// Shared contracts between modules. Change only with the lead's agreement:
// analysis/ → scoring/ → pipeline → audio/worker → UI pages → storage/.

/** One analysis frame of the raw recording. */
export interface PitchFrame {
  /** Frame centre time in seconds from recording start. */
  t: number
  /** Detected fundamental in Hz, or null when unvoiced / low confidence. */
  hz: number | null
  /** Pitch detector confidence, 0–1. */
  clarity: number
  /** Frame RMS level (linear, 0–1). */
  rms: number
}

/** A segmented note (PRD「音符切分」: voiced, < 50 cents drift, ≥ 100 ms). */
export interface Note {
  /** Seconds. */
  start: number
  end: number
  /** Median pitch as fractional MIDI number (69 = A4 440 Hz). */
  midi: number
  /** Indices into AnalysisFeatures.frames, inclusive start / exclusive end. */
  frameStart: number
  frameEnd: number
}

export type Mode = 'major' | 'minor'

export interface KeyInfo {
  /** Pitch class of the tonic, 0 = C … 11 = B. */
  tonic: number
  mode: Mode
  /** Correlation of the best template, roughly 0–1. */
  confidence: number
  /** When true the key was not trusted and pitch is judged against nearest semitone. */
  fallback: boolean
  /** Display label in Traditional Chinese, e.g. "G 大調", "E 小調", "未定（最近半音）". */
  label: string
}

/** Everything the analysis engine extracts from audio; input to scoring. */
export interface AnalysisFeatures {
  sampleRate: number
  durationSec: number
  /** Hop between frames in seconds (frames[i].t ≈ i * hopSec + offset). */
  hopSec: number
  frames: PitchFrame[]
  notes: Note[]
  key: KeyInfo
  /** Note onset times in seconds. */
  onsets: number[]
}

export type ScoreKey = 'pitch' | 'rhythm' | 'breath' | 'vibrato'

/** 0–100 per item; null = 未評 (not scored). total is the weighted mean of scored items. */
export interface Scores {
  total: number | null
  pitch: number | null
  rhythm: number | null
  breath: number | null
  vibrato: number | null
}

export interface Issue {
  /** Seconds. */
  start: number
  end: number
  type: ScoreKey
  /** One concrete suggestion in Traditional Chinese, e.g. "0:42 長音偏低約 30 cents，尾音氣不足". */
  message: string
}

/** Down-sampled pitch curve point (every 50 ms). */
export interface PitchPoint {
  t: number
  midi: number | null
}

/** Result of analyzing one recording, before the user saves it. */
export interface AnalysisReport {
  durationSec: number
  bpm: number | null
  key: KeyInfo
  scores: Scores
  issues: Issue[]
  pitchSummary: PitchPoint[]
  appVersion: string
}

/** One stored history record (PRD「單筆紀錄資料結構」). Audio is never stored. */
export interface SessionRecord {
  id: string
  songName: string
  /** ISO date-time. */
  createdAt: string
  durationSec: number
  bpm: number | null
  /** KeyInfo.label */
  key: string
  scores: Scores
  issues: Issue[]
  pitchSummary: PitchPoint[]
  appVersion: string
}

/** Raw mono recording handed from the recorder to the analysis worker. */
export interface RecordedAudio {
  samples: Float32Array
  sampleRate: number
}
