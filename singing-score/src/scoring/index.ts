import type { AnalysisFeatures, Issue, Scores } from '../types'

/**
 * Scoring entry point (owner: scoring agent).
 * Turns extracted features into the four PRD scores, the weighted total and up to 3 issues.
 * bpm null → rhythm is 未評 (null).
 */
export function scoreFeatures(
  _features: AnalysisFeatures,
  _bpm: number | null,
): { scores: Scores; issues: Issue[] } {
  throw new Error('scoreFeatures not implemented')
}
