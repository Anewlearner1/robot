import { useCallback, useRef, useState } from 'preact/hooks'
import { rmsToLevel } from './VolumeMeter'

/** RMS below this is "very quiet" (≈ −40 dBFS). */
export const QUIET_RMS = 0.01
/** How long it must stay quiet before hinting 太小聲. */
export const QUIET_MS = 1000
/** Peak at/above this counts as clipping (爆音). */
export const CLIP_PEAK = 0.99
/** Keep the 爆音 hint visible this long after the last clip. */
const CLIP_HOLD_MS = 1000

export interface LevelState {
  level: number
  quiet: boolean
  clipping: boolean
}

const INITIAL: LevelState = { level: 0, quiet: false, clipping: false }

/** Turns recorder onLevel callbacks into meter level + 太小聲 / 爆音 hints. */
export function useLevelMonitor() {
  const [state, setState] = useState<LevelState>(INITIAL)
  const quietSince = useRef<number | null>(null)
  const lastClip = useRef(-Infinity)

  const onLevel = useCallback((rms: number, peak: number) => {
    const now = performance.now()
    let quiet = false
    if (rms < QUIET_RMS) {
      if (quietSince.current == null) quietSince.current = now
      quiet = now - quietSince.current > QUIET_MS
    } else {
      quietSince.current = null
    }
    if (peak >= CLIP_PEAK) lastClip.current = now
    setState({ level: rmsToLevel(rms), quiet, clipping: now - lastClip.current < CLIP_HOLD_MS })
  }, [])

  const reset = useCallback(() => {
    quietSince.current = null
    lastClip.current = -Infinity
    setState(INITIAL)
  }, [])

  return { ...state, onLevel, reset }
}
