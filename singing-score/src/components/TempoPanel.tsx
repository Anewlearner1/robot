import { useRef, useState } from 'preact/hooks'
import { createTapTempo } from '../audio'

export interface TempoPanelProps {
  bpm: number | null
  onBpmChange: (bpm: number | null) => void
}

export const MIN_BPM = 40
export const MAX_BPM = 240
const MIN_TAPS = 4

const clampBpm = (b: number) => Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(b)))

/** Optional tempo (F3): tap ≥ 4 times to set BPM, ± 1 to fine-tune, or skip rhythm scoring. */
export function TempoPanel({ bpm, onBpmChange }: TempoPanelProps) {
  const tapper = useRef<ReturnType<typeof createTapTempo> | null>(null)
  const [count, setCount] = useState(0)

  const getTapper = () => (tapper.current ??= createTapTempo())

  const onTap = () => {
    const t = getTapper()
    const result = t.tap()
    setCount(t.count)
    if (result != null && t.count >= MIN_TAPS) onBpmChange(clampBpm(result))
  }

  const skip = () => {
    getTapper().reset()
    setCount(0)
    onBpmChange(null)
  }

  return (
    <section class="card tempo-panel" aria-labelledby="tempo-title">
      <h2 id="tempo-title" class="section-title">
        速度（選填）
      </h2>
      <p class="muted small">跟著歌曲拍子點至少 4 下來設定 BPM。不設定 BPM 就不評節奏分數。</p>

      <button type="button" class="tap-button" onClick={onTap}>
        <span class="tap-button-main">點擊打拍</span>
        <span class="tap-button-sub">{count > 0 ? `已點 ${count} 下` : '跟著拍子點'}</span>
      </button>

      <div class="bpm-row">
        <button
          type="button"
          class="btn btn-secondary btn-square"
          aria-label="BPM 減 1"
          disabled={bpm == null || bpm <= MIN_BPM}
          onClick={() => bpm != null && onBpmChange(clampBpm(bpm - 1))}
        >
          −
        </button>
        <output class="bpm-value" aria-live="polite">
          {bpm == null ? (count > 0 && count < MIN_TAPS ? `再點 ${MIN_TAPS - count} 下` : '未設定') : `${bpm} BPM`}
        </output>
        <button
          type="button"
          class="btn btn-secondary btn-square"
          aria-label="BPM 加 1"
          disabled={bpm == null || bpm >= MAX_BPM}
          onClick={() => bpm != null && onBpmChange(clampBpm(bpm + 1))}
        >
          +
        </button>
      </div>

      <button type="button" class="btn btn-ghost" onClick={skip}>
        跳過（不評節奏）
      </button>
    </section>
  )
}
