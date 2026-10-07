// Message protocol of analysis.worker.ts. Kept free of the pipeline import so the
// main bundle (analyzeInWorker) and tests don't pull in the analysis engine.
import type { AnalysisReport } from '../types'

export interface AnalyzeRequest {
  samples: Float32Array
  sampleRate: number
  bpm: number | null
}

export type AnalyzeResponse = { ok: true; report: AnalysisReport } | { ok: false; error: string }

export type AnalyzeFn = (samples: Float32Array, sampleRate: number, bpm: number | null) => AnalysisReport

/** Validate a request; returns an error message or null when valid. */
export function validateRequest(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return 'invalid request'
  const r = data as Partial<AnalyzeRequest>
  if (!(r.samples instanceof Float32Array)) return 'samples must be a Float32Array'
  if (typeof r.sampleRate !== 'number' || !Number.isFinite(r.sampleRate) || r.sampleRate <= 0)
    return 'sampleRate must be a positive number'
  if (r.bpm !== null && (typeof r.bpm !== 'number' || !Number.isFinite(r.bpm) || r.bpm <= 0))
    return 'bpm must be null or a positive number'
  return null
}

/** Pure handler: run `analyze` on a request and wrap the outcome. Never throws. */
export function handleMessage(data: unknown, analyze: AnalyzeFn): AnalyzeResponse {
  const invalid = validateRequest(data)
  if (invalid) return { ok: false, error: invalid }
  const { samples, sampleRate, bpm } = data as AnalyzeRequest
  try {
    return { ok: true, report: analyze(samples, sampleRate, bpm) }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message || err.name : String(err) }
  }
}
