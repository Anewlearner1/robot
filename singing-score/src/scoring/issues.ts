import type { AnalysisFeatures, Issue, Note, ScoreKey } from '../types'
import type { BreathResult, NoteBreath } from './breath'
import { scoringConfig, type ScoringConfig } from './config'
import { allowedPitchClasses, deviationCents, scorePitch, type PitchResult } from './pitch'
import { gridDeviation, scoreRhythm, type RhythmResult } from './rhythm'
import { formatTime, isLongNote, noteDuration, weightedMean } from './util'
import type { NoteVibrato, VibratoResult } from './vibrato'

export interface ItemResults {
  pitch: PitchResult
  rhythm: RhythmResult
  breath: BreathResult
  vibrato: VibratoResult
}

interface Candidate {
  type: ScoreKey
  score: number
  /** Window bounds (used for the non-overlap rule). */
  ws: number
  we: number
  /** Span of the offending notes / onsets inside the window (reported as the issue). */
  start: number
  end: number
  message: string
}

const centre = (n: Note) => (n.start + n.end) / 2
const r0 = (x: number) => Math.round(Math.abs(x))

/** Start times of the sliding windows: every stepSec, plus one ending exactly at the recording end. */
export function windowStarts(durationSec: number, cfg: ScoringConfig = scoringConfig): number[] {
  const { windowSec, stepSec } = cfg.issues
  const last = Math.max(0, durationSec - windowSec)
  const out: number[] = []
  for (let s = 0; s < last - 1e-9; s += stepSec) out.push(s)
  out.push(last)
  return out
}

/**
 * 問題段落: slide a window over the recording, re-score each item locally with the same
 * functions, keep (window, item) pairs scoring below issues.badScore, then greedily take the
 * lowest-scoring ones whose windows do not overlap, up to maxIssues, sorted by time.
 * Items that are 未評 globally never produce issues.
 */
export function findIssues(
  features: AnalysisFeatures,
  bpm: number | null,
  results: ItemResults,
  cfg: ScoringConfig = scoringConfig,
): Issue[] {
  const ic = cfg.issues
  const pcs = allowedPitchClasses(features.key, cfg)
  const onsets = features.onsets.length ? features.onsets : features.notes.map((n) => n.start)
  const breathByNote = new Map<Note, NoteBreath>(results.breath.perNote.map((b) => [b.note, b]))
  const cands: Candidate[] = []

  for (const ws of windowStarts(features.durationSec, cfg)) {
    const we = ws + ic.windowSec
    const inWin = (t: number) => t >= ws && t < we
    const notes = features.notes.filter((n) => inWin(centre(n)))

    // 音準
    if (results.pitch.score !== null) {
      const r = scorePitch(notes, features.key, cfg, ic.minNotesPitch)
      if (r.score !== null && r.score < ic.badScore) {
        const bad = notes.filter((n) => Math.abs(deviationCents(n.midi - r.tuningOffsetCents / 100, pcs)) > cfg.pitch.fullCents)
        const span = spanOf(bad.length ? bad : notes, ws, we)
        const badLong = bad.filter((n) => isLongNote(n, cfg.longNoteSec))
        const subj = badLong.length ? '長音' : '這段'
        const weakTail = badLong.some((n) => {
          const b = breathByNote.get(n)
          return b !== undefined && (b.tailDrop > cfg.breath.tailDropRatio || b.driftCentsPerSec < -cfg.breath.driftFull)
        })
        let message: string
        if (r.meanSignedCents <= -0.6 * r.meanAbsCents) {
          message = `${subj}偏低約 ${r0(r.meanSignedCents)} cents，${weakTail ? '尾音氣不足' : '先在心裡想好音高，把音往上提'}`
        } else if (r.meanSignedCents >= 0.6 * r.meanAbsCents) {
          message = `${subj}偏高約 ${r0(r.meanSignedCents)} cents，喉嚨放鬆、別用力往上推`
        } else {
          message = `音準不穩，平均偏差約 ${r0(r.meanAbsCents)} cents，放慢速度逐音對準`
        }
        cands.push({ type: 'pitch', score: r.score, ws, we, ...span, message: `${formatTime(span.start)} ${message}` })
      }
    }

    // 節奏 (reuse the global grid phase so a window cannot "fit" its own grid)
    if (results.rhythm.score !== null && bpm !== null) {
      const local = onsets.filter(inWin)
      const r = scoreRhythm(local, bpm, cfg, { offsetSec: results.rhythm.offsetSec, minOnsets: ic.minOnsetsRhythm })
      if (r.score !== null && r.score < ic.badScore) {
        const off = local.filter((t) => Math.abs(gridDeviation(t, r.gridSec, r.offsetSec)) * 1000 > cfg.rhythm.fullMs)
        const pts = off.length ? off : local
        const span = { start: Math.min(...pts), end: Math.min(we, Math.max(...pts) + 0.1) }
        let message: string
        if (r.meanSignedMs >= 0.6 * r.meanDevMs) {
          message = `起音比拍點晚約 ${r0(r.meanSignedMs)} ms，提早準備換氣再進拍`
        } else if (r.meanSignedMs <= -0.6 * r.meanDevMs) {
          message = `起音比拍點早約 ${r0(r.meanSignedMs)} ms，別搶拍，等拍點再進`
        } else {
          message = `節奏不穩，起音平均偏離拍點約 ${r0(r.meanDevMs)} ms，跟著節拍器練習`
        }
        cands.push({ type: 'rhythm', score: r.score, ws, we, ...span, message: `${formatTime(span.start)} ${message}` })
      }
    }

    // 氣息
    if (results.breath.score !== null) {
      const local = results.breath.perNote.filter((b) => inWin(centre(b.note)))
      if (local.length) {
        const w = local.map((b) => noteDuration(b.note))
        const score = weightedMean(local.map((b) => b.score), w)
        if (score < ic.badScore) {
          const cvScore = weightedMean(local.map((b) => b.cvScore), w)
          const driftScore = weightedMean(local.map((b) => b.driftScore), w)
          const worst = local.reduce((a, b) => (b.score < a.score ? b : a))
          const span = spanOf([worst.note], ws, we)
          let message: string
          if (cvScore <= driftScore) {
            const cv = weightedMean(local.map((b) => b.cv), w)
            message = `長音音量起伏大（約 ${Math.round(cv * 100)}%），試著穩定吐氣`
          } else {
            const d = weightedMean(local.map((b) => b.driftCentsPerSec), w)
            message = `長音音高${d < 0 ? '往下掉' : '往上飄'}約 ${r0(d)} cents/秒，用腹部支撐穩住氣息`
          }
          cands.push({ type: 'breath', score, ws, we, ...span, message: `${formatTime(span.start)} ${message}` })
        }
      }
    }

    // 顫音
    if (results.vibrato.score !== null) {
      const local = results.vibrato.perNote.filter((v) => inWin(centre(v.note)))
      if (local.length) {
        const w = local.map((v) => noteDuration(v.note))
        const score = weightedMean(local.map((v) => v.score), w)
        if (score < ic.badScore) {
          const worst = local.reduce((a, b) => (b.score < a.score ? b : a))
          const span = { start: Math.max(ws, worst.start), end: Math.min(we, worst.end) }
          cands.push({ type: 'vibrato', score, ws, we, ...span, message: `${formatTime(span.start)} ${vibratoMessage(worst, cfg)}` })
        }
      }
    }
  }

  const order: ScoreKey[] = ['pitch', 'rhythm', 'breath', 'vibrato']
  cands.sort((a, b) => a.score - b.score || order.indexOf(a.type) - order.indexOf(b.type) || a.ws - b.ws)
  const chosen: Candidate[] = []
  for (const c of cands) {
    if (chosen.length >= ic.maxIssues) break
    if (chosen.some((o) => c.ws < o.we && o.ws < c.we)) continue
    chosen.push(c)
  }
  return chosen
    .sort((a, b) => a.start - b.start)
    .map(({ start, end, type, message }) => ({ start: +start.toFixed(2), end: +end.toFixed(2), type, message }))
}

function spanOf(notes: Note[], ws: number, we: number): { start: number; end: number } {
  if (!notes.length) return { start: ws, end: we }
  return {
    start: Math.max(ws, Math.min(...notes.map((n) => n.start))),
    end: Math.min(we, Math.max(...notes.map((n) => n.end))),
  }
}

function vibratoMessage(v: NoteVibrato, cfg: ScoringConfig): string {
  const c = cfg.vibrato
  const worst = Math.min(v.rateScore, v.extentScore, v.regularityScore)
  if (worst === v.rateScore) {
    return v.rateHz > c.rateFullHigh
      ? `顫音太快（約 ${v.rateHz.toFixed(1)} Hz），放鬆喉嚨讓顫音慢一點`
      : `顫音太慢（約 ${v.rateHz.toFixed(1)} Hz），試著讓顫音輕快一點`
  }
  if (worst === v.extentScore) {
    return v.extentCents > c.extentFullHigh
      ? `顫音幅度太大（約 ${Math.round(v.extentCents)} cents），收小一點避免聽起來搖晃`
      : `顫音幅度太小（約 ${Math.round(v.extentCents)} cents），可以再放開一點`
  }
  return `顫音忽快忽慢（週期變化約 ${Math.round(v.periodCv * 100)}%），先練穩定的長音再加顫音`
}
