import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AnalysisReport } from '../types'
import { analyzeInWorker } from './analyzeInWorker'
import type { AnalyzeResponse } from './worker-protocol'

class FakeWorker {
  static last: FakeWorker | null = null
  static reply: ((req: unknown) => AnalyzeResponse | 'crash') | null = null
  url: URL
  opts: WorkerOptions
  terminated = false
  transfer: Transferable[] = []
  onmessage: ((e: { data: unknown }) => void) | null = null
  onerror: ((e: { message: string; preventDefault(): void }) => void) | null = null
  onmessageerror: (() => void) | null = null
  constructor(url: URL, opts: WorkerOptions) {
    this.url = url
    this.opts = opts
    FakeWorker.last = this
  }
  postMessage(req: { samples: Float32Array }, transfer: Transferable[]) {
    this.transfer = transfer
    const reply = FakeWorker.reply!(req)
    queueMicrotask(() => {
      if (reply === 'crash') this.onerror?.({ message: 'SyntaxError in worker', preventDefault() {} })
      else this.onmessage?.({ data: reply })
    })
  }
  terminate() {
    this.terminated = true
  }
}

const report = { durationSec: 2 } as AnalysisReport

afterEach(() => vi.unstubAllGlobals())

describe('analyzeInWorker', () => {
  it('posts the request with the samples buffer transferred, resolves the report, terminates', async () => {
    vi.stubGlobal('Worker', FakeWorker)
    let seen: unknown
    FakeWorker.reply = (req) => {
      seen = req
      return { ok: true, report }
    }
    const samples = new Float32Array(16)
    await expect(analyzeInWorker({ samples, sampleRate: 48000 }, 90)).resolves.toBe(report)
    const w = FakeWorker.last!
    expect(w.url.pathname).toMatch(/analysis\.worker\.ts$/)
    expect(w.opts.type).toBe('module')
    expect(w.transfer).toEqual([samples.buffer])
    expect(seen).toEqual({ samples, sampleRate: 48000, bpm: 90 })
    expect(w.terminated).toBe(true)
  })

  it('rejects with the worker error message and terminates', async () => {
    vi.stubGlobal('Worker', FakeWorker)
    FakeWorker.reply = () => ({ ok: false, error: 'extractFeatures not implemented' })
    await expect(analyzeInWorker({ samples: new Float32Array(4), sampleRate: 44100 }, null)).rejects.toThrow(
      'extractFeatures not implemented',
    )
    expect(FakeWorker.last!.terminated).toBe(true)
  })

  it('rejects when the worker crashes / fails to load', async () => {
    vi.stubGlobal('Worker', FakeWorker)
    FakeWorker.reply = () => 'crash'
    await expect(analyzeInWorker({ samples: new Float32Array(4), sampleRate: 44100 }, null)).rejects.toThrow(
      /SyntaxError/,
    )
    expect(FakeWorker.last!.terminated).toBe(true)
  })

  it('rejects when Worker is unavailable', async () => {
    vi.stubGlobal('Worker', undefined)
    await expect(analyzeInWorker({ samples: new Float32Array(4), sampleRate: 44100 }, null)).rejects.toThrow()
  })

  it('does not try to transfer a detached buffer', async () => {
    vi.stubGlobal('Worker', FakeWorker)
    FakeWorker.reply = () => ({ ok: true, report })
    const samples = new Float32Array(8)
    structuredClone(samples.buffer, { transfer: [samples.buffer] }) // detach
    await analyzeInWorker({ samples, sampleRate: 1 }, null)
    expect(FakeWorker.last!.transfer).toEqual([])
  })
})
