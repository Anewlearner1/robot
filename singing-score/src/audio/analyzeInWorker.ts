import type { AnalysisReport, RecordedAudio } from '../types'
import type { AnalyzeRequest, AnalyzeResponse } from './worker-protocol'

/**
 * Analyze a recording in a dedicated module worker (one worker per call,
 * terminated after the reply).
 *
 * The samples' ArrayBuffer is TRANSFERRED (zero-copy): after this call
 * `audio.samples` is detached (length 0) on the caller side. Keep your own copy
 * first if you need to re-analyze.
 */
export function analyzeInWorker(audio: RecordedAudio, bpm: number | null): Promise<AnalysisReport> {
  return new Promise<AnalysisReport>((resolve, reject) => {
    let worker: Worker
    try {
      worker = new Worker(new URL('./analysis.worker.ts', import.meta.url), {
        type: 'module',
        name: 'analysis',
      })
    } catch (err) {
      reject(err)
      return
    }
    let settled = false
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      worker.terminate()
      fn()
    }
    worker.onmessage = (e: MessageEvent<AnalyzeResponse>) => {
      const res = e.data
      if (res && res.ok) finish(() => resolve(res.report))
      else finish(() => reject(new Error(res && !res.ok ? res.error : 'invalid worker response')))
    }
    worker.onerror = (e: ErrorEvent) => {
      e.preventDefault()
      finish(() => reject(new Error(e.message || 'analysis worker failed to load or crashed')))
    }
    worker.onmessageerror = () => {
      finish(() => reject(new Error('analysis worker message could not be deserialized')))
    }

    const { samples, sampleRate } = audio
    const req: AnalyzeRequest = { samples, sampleRate, bpm }
    // Only a plain, non-detached ArrayBuffer can be transferred.
    const transfer =
      samples.buffer instanceof ArrayBuffer && samples.buffer.byteLength > 0 ? [samples.buffer] : []
    try {
      worker.postMessage(req, transfer)
    } catch (err) {
      finish(() => reject(err))
    }
  })
}
