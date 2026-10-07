export interface VolumeMeterProps {
  /** 0–1 display level (already mapped to a perceptual scale). */
  level: number
  clipping?: boolean
}

/** Map linear RMS to a 0–1 meter level over a 60 dB range. */
export function rmsToLevel(rms: number): number {
  const db = 20 * Math.log10(Math.max(rms, 1e-6))
  return Math.min(1, Math.max(0, (db + 60) / 60))
}

export function VolumeMeter({ level, clipping = false }: VolumeMeterProps) {
  const pct = Math.round(level * 100)
  return (
    <div
      class={`volume-meter${clipping ? ' clipping' : ''}`}
      role="meter"
      aria-label="音量"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
    >
      <div class="volume-meter-fill" style={{ transform: `scaleX(${level})` }} />
    </div>
  )
}
