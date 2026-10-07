import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MicPermissionError, toMicError } from './errors'
import { AUDIO_CONSTRAINTS, chooseChunkSize, createRecorder, readAppliedProcessing } from './recorder'
import type { FromWorklet, ToWorklet } from './worklet-protocol'

// ---------- minimal Web Audio / getUserMedia fakes ----------

class FakeTrack {
  stopped = false
  settings: MediaTrackSettings = { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
  /** When false, applyConstraints is a no-op (engine can't turn processing off). */
  honoursApply = true
  private ended: (() => void)[] = []
  getSettings = () => this.settings
  stop = () => {
    this.stopped = true
  }
  applyConstraints = vi.fn(async (c: MediaTrackConstraints) => {
    if (this.honoursApply) this.settings = { ...this.settings, ...(c as MediaTrackSettings) }
  })
  addEventListener(type: string, fn: () => void) {
    if (type === 'ended') this.ended.push(fn)
  }
  removeEventListener(type: string, fn: () => void) {
    if (type === 'ended') this.ended = this.ended.filter((f) => f !== fn)
  }
  fireEnded() {
    this.ended.forEach((f) => f())
  }
}

class FakeStream {
  track = new FakeTrack()
  getTracks = () => [this.track]
  getAudioTracks = () => [this.track]
}

class FakeNode {
  connect = vi.fn()
  disconnect = vi.fn()
}

class FakeScriptProcessor extends FakeNode {
  onaudioprocess: ((e: unknown) => void) | null = null
  readonly bufferSize: number
  constructor(bufferSize: number) {
    super()
    this.bufferSize = bufferSize
  }
  feed(...chans: Float32Array[]) {
    const out = new Float32Array(chans[0].length).fill(9)
    this.onaudioprocess?.({
      inputBuffer: { numberOfChannels: chans.length, getChannelData: (i: number) => chans[i] },
      outputBuffer: { numberOfChannels: 1, getChannelData: () => out },
    })
    return out
  }
}

class FakeAudioContext {
  static last: FakeAudioContext | null = null
  static rate = 1000
  sampleRate = FakeAudioContext.rate
  state: AudioContextState = 'suspended'
  destination = {}
  sp: FakeScriptProcessor | null = null
  gain: (FakeNode & { gain: { value: number } }) | null = null
  audioWorklet?: { addModule: (url: string) => Promise<void> }
  constructor() {
    FakeAudioContext.last = this
  }
  resume = vi.fn(async () => {
    if (this.state !== 'closed') this.state = 'running'
  })
  close = vi.fn(async () => {
    this.state = 'closed'
  })
  createMediaStreamSource = vi.fn(() => new FakeNode())
  createGain = () => {
    this.gain = Object.assign(new FakeNode(), { gain: { value: 1 } })
    return this.gain
  }
  createScriptProcessor = (size: number) => {
    this.sp = new FakeScriptProcessor(size)
    return this.sp
  }
}

/** Fake AudioWorkletNode whose "processor" holds a tail that it emits on flush. */
class FakeWorkletNode extends FakeNode {
  static last: FakeWorkletNode | null = null
  tail = new Float32Array(0)
  options: AudioWorkletNodeOptions
  sent: ToWorklet[] = []
  port = {
    onmessage: null as ((e: { data: FromWorklet }) => void) | null,
    postMessage: (msg: ToWorklet) => {
      this.sent.push(msg)
      if (msg.type === 'flush') {
        queueMicrotask(() => {
          if (this.tail.length) this.emit({ type: 'chunk', samples: this.tail })
          this.emit({ type: 'flushed' })
        })
      }
    },
  }
  constructor(_ctx: unknown, _name: string, options: AudioWorkletNodeOptions) {
    super()
    this.options = options
    FakeWorkletNode.last = this
  }
  emit(data: FromWorklet) {
    this.port.onmessage?.({ data })
  }
}

let gum: ReturnType<typeof vi.fn>
let lastStream: FakeStream | null

beforeEach(() => {
  lastStream = null
  FakeAudioContext.last = null
  FakeAudioContext.rate = 1000
  gum = vi.fn(async () => (lastStream = new FakeStream()))
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: gum } })
  vi.stubGlobal('AudioContext', FakeAudioContext)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

const ctx = () => FakeAudioContext.last!
const ramp = (n: number, start = 0) => Float32Array.from({ length: n }, (_, i) => (start + i) / 10000)

// ---------- tests ----------

describe('createRecorder (ScriptProcessor fallback path)', () => {
  it('creates + resumes the context and calls getUserMedia synchronously (inside the user gesture)', async () => {
    const order: string[] = []
    gum.mockImplementation(async () => {
      order.push(`gum(ctx resumed: ${ctx().resume.mock.calls.length > 0})`)
      return (lastStream = new FakeStream())
    })
    const rec = createRecorder()
    const p = rec.start()
    order.push('sync-return')
    await p
    expect(order).toEqual(['gum(ctx resumed: true)', 'sync-return'])
    expect(gum).toHaveBeenCalledWith({ audio: AUDIO_CONSTRAINTS })
    expect(AUDIO_CONSTRAINTS).toMatchObject({
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 1,
    })
    expect(rec.recording).toBe(true)
    expect(rec.captureMode).toBe('script-processor')
    expect(ctx().sp!.bufferSize).toBe(chooseChunkSize(1000))
    // never plays the mic back: muted sink
    expect(ctx().gain!.gain.value).toBe(0)
    rec.cancel()
  })

  it('accumulates chunks, reports levels and returns mono PCM; releases the mic on stop', async () => {
    const levels: [number, number][] = []
    const rec = createRecorder({ onLevel: (r, p) => levels.push([r, p]) })
    await rec.start()
    const sp = ctx().sp!
    const out = sp.feed(ramp(100))
    expect(Array.from(out).every((v) => v === 0)).toBe(true) // output silenced
    sp.feed(ramp(100, 100), ramp(100, 100)) // stereo → averaged (same values)
    const audio = await rec.stop()
    expect(audio.sampleRate).toBe(1000)
    expect(audio.samples.length).toBe(200)
    expect(audio.samples[150]).toBeCloseTo(0.015, 6)
    expect(levels).toHaveLength(2)
    expect(levels[1][1]).toBeCloseTo(0.0199, 4)
    expect(rec.recording).toBe(false)
    expect(lastStream!.track.stopped).toBe(true)
    expect(ctx().close).toHaveBeenCalled()
    // stop() is idempotent after it resolved
    await expect(rec.stop()).resolves.toBe(audio)
  })

  it('copies ScriptProcessor buffers (engine reuses them)', async () => {
    const rec = createRecorder()
    await rec.start()
    const buf = Float32Array.of(0.5, 0.5)
    ctx().sp!.feed(buf)
    buf.fill(0)
    const audio = await rec.stop()
    expect(Array.from(audio.samples)).toEqual([0.5, 0.5])
  })

  it('auto-stops at maxSec, fires onAutoStop and cuts off the excess', async () => {
    const onAutoStop = vi.fn()
    const rec = createRecorder({ maxSec: 0.25, onAutoStop }) // 250 samples @ 1 kHz
    await rec.start()
    const sp = ctx().sp!
    sp.feed(ramp(100))
    sp.feed(ramp(100, 100))
    sp.feed(ramp(100, 200))
    sp.feed(ramp(100, 300)) // ignored
    await vi.waitFor(() => expect(onAutoStop).toHaveBeenCalledTimes(1))
    const audio = onAutoStop.mock.calls[0][0]
    expect(audio.samples.length).toBe(250)
    expect(audio.samples[249]).toBeCloseTo(0.0249, 6)
    expect(rec.recording).toBe(false)
    expect(lastStream!.track.stopped).toBe(true)
    // a stop() racing the auto-stop gets the same audio
    await expect(rec.stop()).resolves.toBe(audio)
  })

  it('treats a mic track ending mid-recording as an auto-stop', async () => {
    const onAutoStop = vi.fn()
    const rec = createRecorder({ onAutoStop })
    await rec.start()
    ctx().sp!.feed(ramp(50))
    lastStream!.track.fireEnded()
    await vi.waitFor(() => expect(onAutoStop).toHaveBeenCalled())
    expect(onAutoStop.mock.calls[0][0].samples.length).toBe(50)
  })

  it('cancel() discards and releases; stop() then rejects', async () => {
    const rec = createRecorder()
    await rec.start()
    ctx().sp!.feed(ramp(10))
    rec.cancel()
    expect(rec.recording).toBe(false)
    expect(lastStream!.track.stopped).toBe(true)
    expect(ctx().close).toHaveBeenCalled()
    await expect(rec.stop()).rejects.toThrow()
  })

  it('cancel() during start() aborts it and stops the late-arriving stream', async () => {
    let resolveGum!: (s: FakeStream) => void
    gum.mockImplementation(() => new Promise((r) => (resolveGum = r)))
    const rec = createRecorder()
    const p = rec.start()
    rec.cancel()
    const stream = new FakeStream()
    resolveGum(stream)
    await expect(p).rejects.toMatchObject({ name: 'AbortError' })
    expect(stream.track.stopped).toBe(true)
    expect(rec.recording).toBe(false)
  })

  it('can record again after stop (new context, mic re-opened)', async () => {
    const rec = createRecorder()
    await rec.start()
    const first = ctx()
    await rec.stop()
    await rec.start()
    expect(ctx()).not.toBe(first)
    expect(gum).toHaveBeenCalledTimes(2)
    ctx().sp!.feed(ramp(3))
    expect((await rec.stop()).samples.length).toBe(3)
  })

  it('rejects a second start() while recording', async () => {
    const rec = createRecorder()
    await rec.start()
    await expect(rec.start()).rejects.toThrow(/already/)
    rec.cancel()
  })

  it('ticks with seconds actually captured', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const ticks: number[] = []
    const rec = createRecorder({ onTick: (s) => ticks.push(s) })
    await rec.start()
    ctx().sp!.feed(ramp(500))
    vi.advanceTimersByTime(250)
    expect(ticks).toEqual([0, 0.5])
    rec.cancel()
    vi.advanceTimersByTime(1000)
    expect(ticks).toEqual([0, 0.5])
  })

  it('uses the context sample rate', async () => {
    FakeAudioContext.rate = 44100
    const rec = createRecorder()
    await rec.start()
    expect(ctx().sp!.bufferSize).toBe(2048)
    ctx().sp!.feed(ramp(2048))
    expect((await rec.stop()).sampleRate).toBe(44100)
  })
})

describe('createRecorder (AudioWorklet path)', () => {
  beforeEach(() => {
    vi.stubGlobal('AudioWorkletNode', FakeWorkletNode)
  })

  it('loads the worklet, receives chunks and flushes the tail on stop', async () => {
    const addModule = vi.fn(async () => {})
    const rec = createRecorder()
    const p = rec.start()
    ctx().audioWorklet = { addModule }
    await p
    expect(addModule).toHaveBeenCalledWith(expect.stringContaining('recorder-worklet'))
    expect(rec.captureMode).toBe('worklet')
    const node = FakeWorkletNode.last!
    expect(node.options).toMatchObject({ channelCount: 1, channelCountMode: 'explicit', processorOptions: { chunkSize: 256 } })
    node.emit({ type: 'chunk', samples: ramp(256) })
    node.tail = ramp(10, 256)
    const audio = await rec.stop()
    expect(node.sent.map((m) => m.type)).toEqual(['flush', 'stop'])
    expect(audio.samples.length).toBe(266)
    expect(audio.samples[265]).toBeCloseTo(0.0265, 6)
  })

  it('falls back to ScriptProcessor when addModule fails', async () => {
    const rec = createRecorder()
    const p = rec.start()
    ctx().audioWorklet = { addModule: vi.fn(async () => Promise.reject(new Error('CSP'))) }
    await p
    expect(rec.captureMode).toBe('script-processor')
    rec.cancel()
  })
})

describe('mic errors', () => {
  it.each([
    ['NotAllowedError', 'denied'],
    ['SecurityError', 'denied'],
    ['NotFoundError', 'no-device'],
    ['NotReadableError', 'busy'],
  ])('%s → MicPermissionError(%s) and context closed', async (name, reason) => {
    gum.mockRejectedValue(Object.assign(new Error('nope'), { name }))
    const rec = createRecorder()
    const err = await rec.start().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(MicPermissionError)
    expect((err as MicPermissionError).reason).toBe(reason)
    expect(ctx().close).toHaveBeenCalled()
    expect(rec.recording).toBe(false)
    // and the recorder is reusable
    gum.mockImplementation(async () => (lastStream = new FakeStream()))
    await rec.start()
    rec.cancel()
  })

  it('retries with {audio:true} on OverconstrainedError', async () => {
    gum.mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'OverconstrainedError' }))
    const rec = createRecorder()
    await rec.start()
    expect(gum).toHaveBeenLastCalledWith({ audio: true })
    rec.cancel()
  })

  it('insecure context (no mediaDevices) → MicPermissionError(insecure)', async () => {
    vi.stubGlobal('navigator', {})
    vi.stubGlobal('isSecureContext', false)
    await expect(createRecorder().start()).rejects.toMatchObject({ name: 'MicPermissionError', reason: 'insecure' })
  })

  it('no getUserMedia in a secure context → unsupported', async () => {
    vi.stubGlobal('navigator', {})
    await expect(createRecorder().start()).rejects.toMatchObject({ reason: 'unsupported' })
  })

  it('toMicError passes unknown errors through', () => {
    const e = new RangeError('x')
    expect(toMicError(e)).toBe(e)
  })
})

describe('applied processing', () => {
  it('null before start, then reports the track settings', async () => {
    const rec = createRecorder()
    expect(rec.getAppliedProcessing()).toBeNull()
    await rec.start()
    expect(rec.getAppliedProcessing()).toEqual({
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    })
    expect(lastStream!.track.applyConstraints).not.toHaveBeenCalled()
    rec.cancel()
  })

  it('retries applyConstraints when AGC came back on, and reports what stuck', async () => {
    gum.mockImplementation(async () => {
      lastStream = new FakeStream()
      lastStream.track.settings = { echoCancellation: false, noiseSuppression: false, autoGainControl: true }
      lastStream.track.honoursApply = false
      return lastStream
    })
    const rec = createRecorder()
    await rec.start()
    expect(lastStream!.track.applyConstraints).toHaveBeenCalled()
    expect(rec.getAppliedProcessing()?.autoGainControl).toBe(true)
    rec.cancel()
  })

  it('maps echoCancellation mode strings and missing fields', () => {
    const t = (settings: MediaTrackSettings) => ({ getSettings: () => settings }) as unknown as MediaStreamTrack
    expect(readAppliedProcessing(t({ echoCancellation: 'all' }))).toEqual({
      echoCancellation: true,
      noiseSuppression: undefined,
      autoGainControl: undefined,
    })
    expect(readAppliedProcessing(undefined).autoGainControl).toBeUndefined()
  })
})

describe('chooseChunkSize', () => {
  it('~25 chunks/s, power of two within 256–16384', () => {
    expect(chooseChunkSize(48000)).toBe(2048)
    expect(chooseChunkSize(44100)).toBe(2048)
    expect(chooseChunkSize(16000)).toBe(512)
    expect(chooseChunkSize(1000)).toBe(256)
    expect(chooseChunkSize(1e6)).toBe(16384)
  })
})
