import { extractFeatures } from './analysis'
import { scoreFeatures } from './scoring'
import type { AnalysisReport, PitchPoint } from './types'
import { APP_VERSION } from './version'

const SUMMARY_STEP_SEC = 0.05

/** Full analysis of one recording. Pure and synchronous; run it inside a Web Worker. */
export function analyze(samples: Float32Array, sampleRate: number, bpm: number | null): AnalysisReport {
  const features = extractFeatures(samples, sampleRate)
  const { scores, issues } = scoreFeatures(features, bpm)
  return {
    durationSec: features.durationSec,
    bpm,
    key: features.key,
    scores,
    issues,
    pitchSummary: summarizePitch(features.frames, features.durationSec),
    appVersion: APP_VERSION,
  }
}

/** Down-sample the frame pitch curve to one point per 50 ms (median of voiced frames in each bin). */
export function summarizePitch(
  frames: { t: number; hz: number | null }[],
  durationSec: number,
): PitchPoint[] {
  const bins = Math.max(1, Math.ceil(durationSec / SUMMARY_STEP_SEC))
  const buckets: number[][] = Array.from({ length: bins }, () => [])
  for (const f of frames) {
    if (f.hz === null) continue
    const i = Math.min(bins - 1, Math.max(0, Math.floor(f.t / SUMMARY_STEP_SEC)))
    buckets[i].push(69 + 12 * Math.log2(f.hz / 440))
  }
  return buckets.map((b, i) => {
    const t = +(i * SUMMARY_STEP_SEC).toFixed(3)
    if (b.length === 0) return { t, midi: null }
    b.sort((x, y) => x - y)
    return { t, midi: +b[Math.floor(b.length / 2)].toFixed(2) }
  })
}
