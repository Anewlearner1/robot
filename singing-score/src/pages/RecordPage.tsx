import { useCallback, useEffect, useReducer, useRef, useState } from 'preact/hooks'
import { analyzeInWorker, createRecorder, MicPermissionError } from '../audio'
import { listSongNames, newRecord, saveRecord } from '../storage'
import type { AnalysisReport, RecordedAudio } from '../types'
import { RecordingPanel } from '../components/RecordingPanel'
import { ReportView } from '../components/ReportView'
import { SongNameField } from '../components/SongNameField'
import { TempoPanel } from '../components/TempoPanel'
import { useLevelMonitor } from '../components/useLevelMonitor'

type Recorder = ReturnType<typeof createRecorder>

/** Recording cap (PRD: 3:00). */
const MAX_SEC = 180

export const MIC_PERMISSION_MESSAGE =
  '無法使用麥克風。請允許麥克風權限後再試一次：iPhone／iPad 到「設定 › Safari › 麥克風」選「允許」，或點網址列的「ᴀA › 網站設定 › 麥克風」；Android Chrome 點網址列左側圖示 ›「權限」› 開啟「麥克風」，然後重新整理頁面。'

/** Tailor the mic message when the recorder reports a reason; default to the permission how-to. */
function micErrorMessage(e: Error): string {
  switch ((e as { reason?: string }).reason) {
    case 'no-device':
      return '找不到麥克風。請確認裝置有麥克風（或已接上耳機麥克風），然後再試一次。'
    case 'busy':
      return '麥克風正被其他 App 使用（例如通話或錄音中）。請結束後再試一次。'
    case 'insecure':
      return '需要透過 https 開啟本網頁才能使用麥克風。'
    case 'unsupported':
      return '這個瀏覽器不支援錄音。請使用 iPhone Safari 或 Android Chrome。'
    default:
      return MIC_PERMISSION_MESSAGE
  }
}

// ---- page state machine: idle → tempo → recording → analyzing → report → saved | error ----

type Phase =
  | { name: 'idle' }
  | { name: 'tempo' }
  | { name: 'recording'; starting: boolean }
  | { name: 'analyzing' }
  | { name: 'report'; report: AnalysisReport; saving: boolean; saveError: string | null }
  | { name: 'saved'; report: AnalysisReport }
  | { name: 'error'; message: string }

type Action =
  | { type: 'songConfirmed' }
  | { type: 'editSong' }
  | { type: 'startRequested' }
  | { type: 'started' }
  | { type: 'captured' }
  | { type: 'analyzed'; report: AnalysisReport }
  | { type: 'saveRequested' }
  | { type: 'saveSucceeded' }
  | { type: 'saveFailed'; message: string }
  | { type: 'discard' }
  | { type: 'failed'; message: string }

function reducer(s: Phase, a: Action): Phase {
  switch (a.type) {
    case 'songConfirmed':
      return s.name === 'idle' ? { name: 'tempo' } : s
    case 'editSong':
      return s.name === 'tempo' ? { name: 'idle' } : s
    case 'startRequested':
      return s.name === 'tempo' || s.name === 'error' ? { name: 'recording', starting: true } : s
    case 'started':
      return s.name === 'recording' ? { name: 'recording', starting: false } : s
    case 'captured':
      return s.name === 'recording' ? { name: 'analyzing' } : s
    case 'analyzed':
      return s.name === 'analyzing' ? { name: 'report', report: a.report, saving: false, saveError: null } : s
    case 'saveRequested':
      return s.name === 'report' ? { ...s, saving: true, saveError: null } : s
    case 'saveSucceeded':
      return s.name === 'report' ? { name: 'saved', report: s.report } : s
    case 'saveFailed':
      return s.name === 'report' ? { ...s, saving: false, saveError: a.message } : s
    case 'discard':
      // 不儲存 / 再唱一次 / 重試: back to tempo, keeping song name & BPM.
      return s.name === 'report' || s.name === 'saved' || s.name === 'error' ? { name: 'tempo' } : s
    case 'failed':
      return { name: 'error', message: a.message }
  }
}

/** Keep the screen awake while recording (best effort; iOS 16.4+, Android Chrome). */
function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return
    let lock: WakeLockSentinel | null = null
    let cancelled = false
    navigator.wakeLock
      .request('screen')
      .then((l) => {
        if (cancelled) void l.release()
        else lock = l
      })
      .catch(() => {})
    return () => {
      cancelled = true
      void lock?.release().catch(() => {})
    }
  }, [active])
}

/** 練唱 tab: song name → optional tap tempo → record → analyze → report → save. */
export function RecordPage() {
  const [phase, dispatch] = useReducer(reducer, { name: 'idle' })
  const [songName, setSongName] = useState('')
  const [bpm, setBpm] = useState<number | null>(null)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [elapsed, setElapsed] = useState(0)
  const monitor = useLevelMonitor()

  const recorder = useRef<Recorder | null>(null)
  const bpmRef = useRef(bpm)
  bpmRef.current = bpm

  const refreshSuggestions = useCallback(() => {
    listSongNames()
      .then(setSuggestions)
      .catch(() => {})
  }, [])

  useEffect(refreshSuggestions, [refreshSuggestions])

  // Cancel an in-flight recording if the page unmounts (e.g. tab switch).
  useEffect(
    () => () => {
      recorder.current?.cancel()
      recorder.current = null
    },
    [],
  )

  const isRecording = phase.name === 'recording'
  useWakeLock(isRecording)
  useEffect(() => {
    document.documentElement.classList.toggle('is-recording', isRecording)
    return () => document.documentElement.classList.remove('is-recording')
  }, [isRecording])

  /**
   * Analyze then drop the audio: it only lives in this call's scope and is released once the
   * worker returns (PRD: audio is discarded). 'captured' is a no-op if stop() already sent it.
   */
  const analyze = async (audio: RecordedAudio) => {
    dispatch({ type: 'captured' })
    try {
      const report = await analyzeInWorker(audio, bpmRef.current)
      dispatch({ type: 'analyzed', report })
    } catch {
      dispatch({ type: 'failed', message: '分析失敗，請再錄一次。' })
    }
  }

  const startRecording = async () => {
    dispatch({ type: 'startRequested' })
    monitor.reset()
    setElapsed(0)
    const rec: Recorder = createRecorder({
      maxSec: MAX_SEC,
      onLevel: monitor.onLevel,
      onTick: setElapsed,
      onAutoStop: (audio) => {
        if (recorder.current !== rec) return
        recorder.current = null
        void analyze(audio)
      },
    })
    recorder.current = rec
    try {
      await rec.start()
      if (recorder.current === rec) dispatch({ type: 'started' })
    } catch (e) {
      if (recorder.current === rec) recorder.current = null
      try {
        rec.cancel()
      } catch {
        /* already torn down */
      }
      dispatch({
        type: 'failed',
        message: e instanceof MicPermissionError ? micErrorMessage(e) : '無法開始錄音，請再試一次。',
      })
    }
  }

  const stopRecording = async () => {
    const rec = recorder.current
    if (!rec) return
    recorder.current = null
    dispatch({ type: 'captured' })
    let audio: RecordedAudio
    try {
      audio = await rec.stop()
    } catch {
      dispatch({ type: 'failed', message: '錄音失敗，請再試一次。' })
      return
    }
    await analyze(audio)
  }

  const save = async (report: AnalysisReport) => {
    dispatch({ type: 'saveRequested' })
    try {
      await saveRecord(newRecord(report, songName.trim()))
      dispatch({ type: 'saveSucceeded' })
      refreshSuggestions()
    } catch {
      dispatch({ type: 'saveFailed', message: '儲存失敗，請再試一次。' })
    }
  }

  const name = songName.trim()

  switch (phase.name) {
    case 'idle':
      return (
        <section class="page">
          <h1 class="page-title">練唱</h1>
          <form
            class="stack"
            onSubmit={(e) => {
              e.preventDefault()
              if (name) dispatch({ type: 'songConfirmed' })
            }}
          >
            <SongNameField value={songName} onChange={setSongName} suggestions={suggestions} />
            <button type="submit" class="btn btn-primary btn-block" disabled={!name}>
              下一步
            </button>
          </form>
        </section>
      )

    case 'tempo':
      return (
        <section class="page">
          <div class="song-header">
            <h1 class="page-title song-title">{name}</h1>
            <button type="button" class="btn btn-ghost btn-small" onClick={() => dispatch({ type: 'editSong' })}>
              換歌
            </button>
          </div>
          <TempoPanel bpm={bpm} onBpmChange={setBpm} />
          <div class="record-start">
            <button type="button" class="record-button" onClick={() => void startRecording()} aria-label="開始錄音">
              <span class="record-button-icon" aria-hidden="true" />
              <span class="record-button-text">開始錄音</span>
            </button>
            <p class="muted small center">請戴耳機聽伴奏，或清唱</p>
          </div>
        </section>
      )

    case 'recording':
      return (
        <section class="page page-recording">
          <RecordingPanel
            elapsedSec={elapsed}
            maxSec={MAX_SEC}
            level={monitor.level}
            quiet={monitor.quiet}
            clipping={monitor.clipping}
            starting={phase.starting}
            onStop={() => void stopRecording()}
          />
        </section>
      )

    case 'analyzing':
      return (
        <section class="page page-center" aria-busy="true">
          <div class="spinner" aria-hidden="true" />
          <p class="status-text" role="status">
            分析中…
          </p>
          <p class="muted small">約需幾秒鐘，請勿關閉頁面</p>
        </section>
      )

    case 'report':
    case 'saved': {
      const { report } = phase
      return (
        <section class="page">
          <h1 class="page-title song-title">{name}</h1>
          <ReportView
            data={{
              scores: report.scores,
              issues: report.issues,
              pitchSummary: report.pitchSummary,
              durationSec: report.durationSec,
              bpm: report.bpm,
              keyLabel: report.key.label,
            }}
          />
          {phase.name === 'report' ? (
            <div class="actions">
              {phase.saveError && (
                <p class="error-text" role="alert">
                  {phase.saveError}
                </p>
              )}
              <button
                type="button"
                class="btn btn-primary btn-block"
                disabled={phase.saving}
                onClick={() => void save(report)}
              >
                {phase.saving ? '儲存中…' : '儲存紀錄'}
              </button>
              <button
                type="button"
                class="btn btn-secondary btn-block"
                disabled={phase.saving}
                onClick={() => dispatch({ type: 'discard' })}
              >
                不儲存
              </button>
            </div>
          ) : (
            <div class="actions">
              <p class="success-text" role="status">
                已儲存紀錄
              </p>
              <button type="button" class="btn btn-primary btn-block" onClick={() => dispatch({ type: 'discard' })}>
                再唱一次
              </button>
              <a class="btn btn-secondary btn-block" href="#/progress">
                查看進步
              </a>
            </div>
          )}
        </section>
      )
    }

    case 'error':
      return (
        <section class="page">
          <div class="card error-card" role="alert">
            <h2 class="section-title">出了點問題</h2>
            <p>{phase.message}</p>
          </div>
          <div class="actions">
            <button type="button" class="btn btn-primary btn-block" onClick={() => dispatch({ type: 'discard' })}>
              返回
            </button>
          </div>
        </section>
      )
  }
}
