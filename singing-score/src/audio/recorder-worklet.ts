// AudioWorklet processor: down-mixes the input to mono, batches 128-frame render
// quanta into larger chunks and posts them (transferred) to the main thread.
// Loaded via `?worker&url` so Vite transpiles + bundles it as a standalone script.
import { ChunkBatcher, downmixToMono } from './pcm'
import {
  RECORDER_PROCESSOR_NAME,
  type FromWorklet,
  type RecorderProcessorOptions,
  type ToWorklet,
} from './worklet-protocol'

// AudioWorkletGlobalScope types are not in lib.dom; declare the bits we use.
declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort
  constructor(options?: AudioWorkletNodeOptions)
}
declare function registerProcessor(
  name: string,
  ctor: new (options: AudioWorkletNodeOptions) => AudioWorkletProcessor,
): void

class RecorderProcessor extends AudioWorkletProcessor {
  private batcher: ChunkBatcher
  private active = true

  constructor(options: AudioWorkletNodeOptions) {
    super(options)
    const opts = options.processorOptions as Partial<RecorderProcessorOptions> | undefined
    this.batcher = new ChunkBatcher(opts?.chunkSize ?? 2048)
    this.port.onmessage = (e: MessageEvent<ToWorklet>) => {
      if (e.data.type === 'flush') {
        this.batcher.flush(this.emit)
        this.post({ type: 'flushed' })
      } else if (e.data.type === 'stop') {
        this.active = false
      }
    }
  }

  private post(msg: FromWorklet, transfer?: Transferable[]): void {
    this.port.postMessage(msg, transfer ?? [])
  }

  private emit = (chunk: Float32Array): void => {
    this.post({ type: 'chunk', samples: chunk }, [chunk.buffer])
  }

  process(inputs: Float32Array[][]): boolean {
    if (!this.active) return false
    const input = inputs[0]
    // No channels = input not (yet) connected / stream muted: nothing to record.
    if (input && input.length > 0) this.batcher.add(downmixToMono(input), this.emit)
    return true
  }
}

registerProcessor(RECORDER_PROCESSOR_NAME, RecorderProcessor)
