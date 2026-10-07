import { formatTimer } from './format'
import { VolumeMeter } from './VolumeMeter'

export interface RecordingPanelProps {
  elapsedSec: number
  maxSec: number
  level: number
  quiet: boolean
  clipping: boolean
  /** True while the microphone is still being opened. */
  starting: boolean
  onStop: () => void
}

/** The only thing on screen while recording: timer, volume meter, level hint, stop button. */
export function RecordingPanel({ elapsedSec, maxSec, level, quiet, clipping, starting, onStop }: RecordingPanelProps) {
  const hint = starting ? '正在開啟麥克風…' : clipping ? '爆音：請離麥克風遠一點或小聲一點' : quiet ? '太小聲：請靠近麥克風或大聲一點' : ''
  return (
    <div class="recording-panel">
      <div class="timer" aria-live="off">
        <span class="timer-elapsed">{formatTimer(elapsedSec)}</span>
        <span class="timer-max"> / {formatTimer(maxSec)}</span>
      </div>
      <VolumeMeter level={level} clipping={clipping} />
      <p class={`level-hint${clipping ? ' bad' : quiet ? ' warn' : ''}`} role="status">
        {hint}
      </p>
      <button type="button" class="record-button recording" onClick={onStop} disabled={starting} aria-label="停止錄音">
        <span class="record-button-icon stop" aria-hidden="true" />
        <span class="record-button-text">停止</span>
      </button>
    </div>
  )
}
