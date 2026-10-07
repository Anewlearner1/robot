import type { ScoreKey } from '../types'

/** Seconds → "m:ss" (e.g. 42.3 → "0:42", 75 → "1:15"). */
export function formatClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Seconds → "mm:ss" for the recording timer (e.g. 5 → "00:05"). */
export function formatTimer(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

/** MIDI number → scientific note name, rounded to the nearest semitone (60 → "C4"). */
export function midiToName(midi: number): string {
  const m = Math.round(midi)
  return `${NOTE_NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`
}

export const SCORE_LABELS: Record<ScoreKey, string> = {
  pitch: '音準',
  rhythm: '節奏',
  breath: '氣息',
  vibrato: '顫音',
}

/** Why an item shows 未評. */
export const UNSCORED_REASONS: Record<ScoreKey, string> = {
  pitch: '有效音符太少',
  rhythm: '未設定 BPM',
  breath: '沒有長音',
  vibrato: '未偵測到顫音（不扣分）',
}

export type ScoreTone = 'good' | 'warn' | 'bad'

export function scoreTone(score: number): ScoreTone {
  return score >= 80 ? 'good' : score >= 60 ? 'warn' : 'bad'
}
