// Audio layer public API (owner: audio agent).
export { MicPermissionError, type MicErrorReason } from './errors'
export {
  createRecorder,
  DEFAULT_MAX_SEC,
  AUDIO_CONSTRAINTS,
  type Recorder,
  type RecorderOptions,
  type AppliedProcessing,
  type CaptureMode,
} from './recorder'
export { createTapTempo, type TapTempo } from './tapTempo'
export { analyzeInWorker } from './analyzeInWorker'
