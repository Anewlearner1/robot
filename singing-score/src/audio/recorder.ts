import type { RecordedAudio } from '../types'
import { MicPermissionError, toMicError } from './errors'
import { computeLevel, downmixToMono, INITIAL_CAPACITY_SEC, PcmAccumulator, secondsToSamples } from './pcm'
import { RECORDER_PROCESSOR_NAME, type FromWorklet, type RecorderProcessorOptions } from './worklet-protocol'
// `?worker&url` makes Vite transpile + bundle the worklet into its own file and give us its URL
// (a plain `new URL('./x.ts', import.meta.url)` would be copied verbatim, i.e. untranspiled TS).
import workletUrl from './recorder-worklet.ts?worker&url'

/** PRD: 3-minute cap. */
export const DEFAULT_MAX_SEC = 180
const TICK_MS = 250
/** Max time stop() waits for the worklet to hand over its last partial chunk. */
const FLUSH_TIMEOUT_MS = 300
/** Max time to wait for AudioContext.resume() (it can stay pending forever on iOS outside a gesture). */
const RESUME_TIMEOUT_MS = 1500

export interface RecorderOptions {
  /** Hard cap in seconds (default 180). Reaching it stops the recorder and fires onAutoStop. */
  maxSec?: number
  /** ~20–30 Hz while recording; linear 0–1 RMS and peak of the latest chunk. */
  onLevel?: (rms: number, peak: number) => void
  /** ~4 Hz; seconds of audio actually captured so far. */
  onTick?: (elapsedSec: number) => void
  /** Fired when maxSec is reached — and also if the mic track ends mid-recording (device lost / revoked). */
  onAutoStop?: (audio: RecordedAudio) => void
}

/** Voice-processing flags the browser reports as actually in effect. undefined = not reported (assume it may be on). */
export interface AppliedProcessing {
  echoCancellation?: boolean
  noiseSuppression?: boolean
  autoGainControl?: boolean
}

export type CaptureMode = 'worklet' | 'script-processor'

export interface Recorder {
  /** Must be called from a user gesture (click) — creates/resumes the AudioContext synchronously. Throws MicPermissionError. */
  start(): Promise<void>
  /** Mono Float32 PCM at the context's sample rate; releases the mic. After an auto-stop, resolves with that same audio. */
  stop(): Promise<RecordedAudio>
  /** Discard everything and release the mic. Safe to call at any time (also aborts a pending start()). */
  cancel(): void
  readonly recording: boolean
  /** Processing flags honoured by the browser for the last opened mic; null before the first successful start(). */
  getAppliedProcessing(): AppliedProcessing | null
  /** Which capture path the last start() used; null before the first start(). */
  readonly captureMode: CaptureMode | null
}

/**
 * Raw-voice constraints (PRD F2). The goog* keys are legacy Chromium names; modern
 * browsers drop unknown dictionary members per WebIDL, so they are harmless no-ops
 * there and only matter for old Chromium builds.
 */
export const AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  channelCount: 1,
  ...({
    googEchoCancellation: false,
    googAutoGainControl: false,
    googAutoGainControl2: false,
    googNoiseSuppression: false,
    googHighpassFilter: false,
  } as Record<string, boolean>),
}

const PROCESSING_OFF: MediaTrackConstraints = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
}

/** Power-of-two chunk size giving ~25 chunks/s (2048 at 44.1/48 kHz), within ScriptProcessor's 256–16384. */
export function chooseChunkSize(sampleRate: number): number {
  const target = sampleRate / 25
  let best = 256
  for (let p = 256; p <= 16384; p *= 2) {
    if (Math.abs(p - target) < Math.abs(best - target)) best = p
  }
  return best
}

export function readAppliedProcessing(track: MediaStreamTrack | undefined): AppliedProcessing {
  const st: MediaTrackSettings = track?.getSettings?.() ?? {}
  return {
    // Newer specs allow a mode string ("all" | "remote-only"); any mode means it is on.
    echoCancellation:
      typeof st.echoCancellation === 'string' ? st.echoCancellation !== 'none' : st.echoCancellation,
    noiseSuppression: st.noiseSuppression,
    autoGainControl: st.autoGainControl,
  }
}

type AudioContextCtor = typeof AudioContext

function getAudioContextCtor(): AudioContextCtor | undefined {
  const g = globalThis as typeof globalThis & { webkitAudioContext?: AudioContextCtor }
  return g.AudioContext ?? g.webkitAudioContext
}

function abortError(): Error {
  return typeof DOMException !== 'undefined'
    ? new DOMException('Recording cancelled', 'AbortError')
    : Object.assign(new Error('Recording cancelled'), { name: 'AbortError' })
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
  return Promise.race([p, new Promise<undefined>((r) => setTimeout(() => r(undefined), ms))])
}

function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((t) => t.stop())
}

interface Session {
  ctx: AudioContext | null
  stream: MediaStream | null
  source: MediaStreamAudioSourceNode | null
  node: AudioNode | null
  sink: GainNode | null
  port: MessagePort | null
  acc: PcmAccumulator | null
  sampleRate: number
  tick: ReturnType<typeof setInterval> | null
  onFlushed: (() => void) | null
  cleanups: (() => void)[]
}

export function createRecorder(opts: RecorderOptions = {}): Recorder {
  const maxSec = opts.maxSec ?? DEFAULT_MAX_SEC
  let state: 'idle' | 'starting' | 'recording' | 'stopping' = 'idle'
  let s: Session | null = null
  let stopPromise: Promise<RecordedAudio> | null = null
  let applied: AppliedProcessing | null = null
  let mode: CaptureMode | null = null

  function release(sess: Session): void {
    if (sess.tick !== null) clearInterval(sess.tick)
    sess.tick = null
    sess.cleanups.splice(0).forEach((f) => f())
    try {
      sess.port?.postMessage({ type: 'stop' })
    } catch {
      /* port already closed */
    }
    if (sess.port) sess.port.onmessage = null
    sess.port = null
    for (const n of [sess.source, sess.node, sess.sink]) {
      try {
        n?.disconnect()
      } catch {
        /* not connected */
      }
    }
    sess.source = sess.node = sess.sink = null
    stopStream(sess.stream)
    sess.stream = null
    const ctx = sess.ctx
    sess.ctx = null
    if (ctx && ctx.state !== 'closed') ctx.close().catch(() => {})
    sess.onFlushed?.()
    sess.onFlushed = null
  }

  function onChunk(sess: Session, chunk: Float32Array): void {
    // Also accepted while 'stopping': the worklet's flushed tail arrives then.
    if (s !== sess || !sess.acc) return
    sess.acc.push(chunk)
    const { rms, peak } = computeLevel(chunk)
    opts.onLevel?.(rms, peak)
    if (sess.acc.full && state === 'recording') autoStop(false)
  }

  async function finalize(sess: Session, flush: boolean): Promise<RecordedAudio> {
    state = 'stopping'
    if (sess.tick !== null) clearInterval(sess.tick)
    sess.tick = null
    if (flush && sess.port) {
      const port = sess.port
      await withTimeout(
        new Promise<void>((resolve) => {
          sess.onFlushed = resolve
          port.postMessage({ type: 'flush' })
        }),
        FLUSH_TIMEOUT_MS,
      )
      sess.onFlushed = null
    }
    if (s !== sess || !sess.acc) throw abortError() // cancel() raced us
    const audio: RecordedAudio = { samples: sess.acc.take(), sampleRate: sess.sampleRate }
    release(sess)
    s = null
    state = 'idle'
    return audio
  }

  function autoStop(flush: boolean): void {
    if (!s || state !== 'recording') return
    const p = finalize(s, flush)
    stopPromise = p
    p.then(
      (audio) => opts.onAutoStop?.(audio),
      () => {},
    )
  }

  async function openStream(md: MediaDevices): Promise<MediaStream> {
    try {
      return await md.getUserMedia({ audio: AUDIO_CONSTRAINTS })
    } catch (err) {
      const name = (err as { name?: string } | null)?.name
      // Shouldn't happen with non-required constraints, but some engines reject e.g. channelCount.
      if (name === 'OverconstrainedError' || name === 'TypeError') {
        try {
          return await md.getUserMedia({ audio: true })
        } catch (err2) {
          throw toMicError(err2)
        }
      }
      throw toMicError(err)
    }
  }

  async function createCaptureNode(sess: Session, ctx: AudioContext, chunkSize: number): Promise<AudioNode> {
    if (typeof AudioWorkletNode !== 'undefined' && ctx.audioWorklet) {
      try {
        await ctx.audioWorklet.addModule(workletUrl)
        const processorOptions: RecorderProcessorOptions = { chunkSize }
        const node = new AudioWorkletNode(ctx, RECORDER_PROCESSOR_NAME, {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [1],
          // Let the engine down-mix to mono before process() (worklet also down-mixes defensively).
          channelCount: 1,
          channelCountMode: 'explicit',
          channelInterpretation: 'speakers',
          processorOptions,
        })
        node.port.onmessage = (e: MessageEvent<FromWorklet>) => {
          if (e.data.type === 'chunk') onChunk(sess, e.data.samples)
          else if (e.data.type === 'flushed') sess.onFlushed?.()
        }
        sess.port = node.port
        mode = 'worklet'
        return node
      } catch (err) {
        console.warn('[audio] AudioWorklet unavailable, falling back to ScriptProcessorNode', err)
      }
    }
    const sp = ctx.createScriptProcessor(chunkSize, 1, 1)
    sp.onaudioprocess = (e: AudioProcessingEvent) => {
      const ib = e.inputBuffer
      const chans: Float32Array[] = []
      for (let c = 0; c < ib.numberOfChannels; c++) chans.push(ib.getChannelData(c))
      const mono = downmixToMono(chans)
      // The engine reuses its buffers: copy before keeping.
      onChunk(sess, mono === chans[0] ? mono.slice() : mono)
      const ob = e.outputBuffer
      for (let c = 0; c < ob.numberOfChannels; c++) ob.getChannelData(c).fill(0)
    }
    mode = 'script-processor'
    return sp
  }

  async function start(): Promise<void> {
    if (state !== 'idle') throw new Error(`Recorder is already ${state}`)
    const sess: Session = {
      ctx: null,
      stream: null,
      source: null,
      node: null,
      sink: null,
      port: null,
      acc: null,
      sampleRate: 0,
      tick: null,
      onFlushed: null,
      cleanups: [],
    }
    s = sess
    state = 'starting'
    stopPromise = null
    const alive = () => {
      if (s !== sess) throw abortError()
    }
    try {
      const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined
      if (!md || typeof md.getUserMedia !== 'function') {
        const insecure = (globalThis as { isSecureContext?: boolean }).isSecureContext === false
        throw new MicPermissionError(
          insecure ? 'Microphone requires HTTPS (insecure context)' : 'getUserMedia is not supported',
          insecure ? 'insecure' : 'unsupported',
        )
      }
      const Ctor = getAudioContextCtor()
      if (!Ctor) throw new MicPermissionError('Web Audio is not supported', 'unsupported')

      // iOS Safari: the AudioContext must be created and resumed synchronously inside the
      // user gesture, i.e. before the first await.
      const ctx = new Ctor({ latencyHint: 'interactive' })
      sess.ctx = ctx
      ctx.resume().catch(() => {})

      const stream = await openStream(md)
      sess.stream = stream
      alive()

      const track = stream.getAudioTracks()[0]
      applied = readAppliedProcessing(track)
      if (track && (applied.autoGainControl || applied.echoCancellation || applied.noiseSuppression)) {
        // Second chance: some engines honour applyConstraints but not the initial request.
        await track.applyConstraints(PROCESSING_OFF).catch(() => {})
        applied = readAppliedProcessing(track)
        alive()
      }

      if (ctx.state !== 'running') {
        await withTimeout(ctx.resume(), RESUME_TIMEOUT_MS).catch(() => {})
        alive()
      }

      const sampleRate = ctx.sampleRate
      sess.sampleRate = sampleRate
      sess.acc = new PcmAccumulator(
        secondsToSamples(maxSec, sampleRate),
        secondsToSamples(INITIAL_CAPACITY_SEC, sampleRate),
      )
      sess.source = ctx.createMediaStreamSource(stream)
      // Capture node must reach the destination to be pulled (Safari / ScriptProcessor);
      // route through a muted gain so the raw mic is never played back.
      sess.sink = ctx.createGain()
      sess.sink.gain.value = 0
      sess.sink.connect(ctx.destination)

      const node = await createCaptureNode(sess, ctx, chooseChunkSize(sampleRate))
      sess.node = node
      alive()
      sess.source.connect(node)
      node.connect(sess.sink)

      // Mic lost (unplugged, permission revoked, taken by a call): keep what we have.
      const onEnded = () => {
        if (s === sess && state === 'recording') autoStop(true)
      }
      track?.addEventListener('ended', onEnded)
      sess.cleanups.push(() => track?.removeEventListener('ended', onEnded))

      // Background tab / iOS interruption suspends the context; resume when visible again.
      if (typeof document !== 'undefined') {
        const onVis = () => {
          if (document.visibilityState === 'visible' && sess.ctx && sess.ctx.state !== 'running')
            sess.ctx.resume().catch(() => {})
        }
        document.addEventListener('visibilitychange', onVis)
        sess.cleanups.push(() => document.removeEventListener('visibilitychange', onVis))
      }

      state = 'recording'
      opts.onTick?.(0)
      sess.tick = setInterval(() => {
        if (s === sess && sess.acc) opts.onTick?.(sess.acc.length / sampleRate)
      }, TICK_MS)
    } catch (err) {
      release(sess)
      if (s === sess) {
        s = null
        state = 'idle'
      }
      throw err
    }
  }

  function stop(): Promise<RecordedAudio> {
    if (stopPromise) return stopPromise
    if (state === 'starting') {
      cancel()
      return Promise.reject(new Error('Recorder was still starting; recording discarded'))
    }
    if (state !== 'recording' || !s) return Promise.reject(new Error('Recorder is not recording'))
    stopPromise = finalize(s, true)
    return stopPromise
  }

  function cancel(): void {
    const sess = s
    s = null
    state = 'idle'
    stopPromise = null
    if (sess) {
      sess.acc?.reset()
      sess.acc = null
      release(sess)
    }
  }

  return {
    start,
    stop,
    cancel,
    get recording() {
      return state === 'recording'
    },
    getAppliedProcessing: () => (applied ? { ...applied } : null),
    get captureMode() {
      return mode
    },
  }
}
