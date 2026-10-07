import type { AnalysisFeatures } from '../types'

/**
 * Analysis engine entry point (owner: analysis agent).
 * Pitch detection, RMS, note segmentation, onsets and key detection on mono PCM.
 */
export function extractFeatures(_samples: Float32Array, _sampleRate: number): AnalysisFeatures {
  throw new Error('extractFeatures not implemented')
}
