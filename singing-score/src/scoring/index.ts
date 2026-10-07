import type { AnalysisFeatures, Issue, ScoreKey, Scores } from '../types'
import { scoreBreath } from './breath'
import { scoringConfig, type ScoringConfig } from './config'
import { findIssues, type ItemResults } from './issues'
import { scorePitch } from './pitch'
import { scoreRhythm } from './rhythm'
import { scoreVibrato } from './vibrato'

export { scoringConfig, type ScoringConfig } from './config'
export type { ItemResults } from './issues'

/** Weighted mean of the scored (non-null) items; null when nothing was scored. */
export function totalScore(items: Record<ScoreKey, number | null>, cfg: ScoringConfig = scoringConfig): number | null {
  let s = 0
  let w = 0
  for (const k of Object.keys(cfg.weights) as ScoreKey[]) {
    const v = items[k]
    if (v === null) continue
    s += cfg.weights[k] * v
    w += cfg.weights[k]
  }
  return w > 0 ? Math.round(s / w) : null
}

/** Raw per-item results (scores unrounded + metrics) — for calibration and debugging. */
export function scoreItems(features: AnalysisFeatures, bpm: number | null, cfg: ScoringConfig = scoringConfig): ItemResults {
  const onsets = features.onsets.length ? features.onsets : features.notes.map((n) => n.start)
  return {
    pitch: scorePitch(features.notes, features.key, cfg),
    rhythm: scoreRhythm(onsets, bpm, cfg),
    breath: scoreBreath(features, features.notes, cfg),
    vibrato: scoreVibrato(features, features.notes, cfg),
  }
}

/**
 * Scoring entry point (owner: scoring agent).
 * Turns extracted features into the four PRD scores, the weighted total and up to 3 issues.
 * bpm null → rhythm is 未評 (null).
 */
export function scoreFeatures(
  features: AnalysisFeatures,
  bpm: number | null,
  cfg: ScoringConfig = scoringConfig,
): { scores: Scores; issues: Issue[] } {
  const results = scoreItems(features, bpm, cfg)
  const round = (x: number | null) => (x === null ? null : Math.round(x))
  const items = {
    pitch: round(results.pitch.score),
    rhythm: round(results.rhythm.score),
    breath: round(results.breath.score),
    vibrato: round(results.vibrato.score),
  }
  return {
    scores: { total: totalScore(items, cfg), ...items },
    issues: findIssues(features, bpm, results, cfg),
  }
}
