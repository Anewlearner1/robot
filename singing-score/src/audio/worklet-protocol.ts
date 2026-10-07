// Message shapes between the recorder (main thread) and recorder-worklet.ts.

export const RECORDER_PROCESSOR_NAME = 'singing-score-recorder'

export interface RecorderProcessorOptions {
  /** Samples per posted chunk. */
  chunkSize: number
}

export type ToWorklet = { type: 'flush' } | { type: 'stop' }

export type FromWorklet = { type: 'chunk'; samples: Float32Array } | { type: 'flushed' }
