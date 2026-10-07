/** 進步 tab: history list filtered by song, trend chart, JSON backup (owner: storage agent). */
import { useCallback, useEffect, useMemo, useState } from 'preact/hooks'
import type { Scores, SessionRecord } from '../types'
import {
  deleteRecord,
  exportAll,
  importJSON,
  lastExportAt,
  listRecords,
  listSongNames,
  markExported,
} from '../storage'
import type { TrendPoint } from '../components/TrendChart'
import './progress.css'

type Metric = keyof Scores

const METRICS: { key: Metric; label: string }[] = [
  { key: 'total', label: '總分' },
  { key: 'pitch', label: '音準' },
  { key: 'rhythm', label: '節奏' },
  { key: 'breath', label: '氣息' },
  { key: 'vibrato', label: '顫音' },
]

const ITEM_METRICS = METRICS.slice(1)
const REMIND_AFTER_MS = 14 * 24 * 3600 * 1000

const pad2 = (n: number) => String(n).padStart(2, '0')

export function formatDate(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

export function formatDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  return `${Math.floor(s / 60)}:${pad2(s % 60)}`
}

export function backupFileName(now = new Date()): string {
  return `singing-score-backup-${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}.json`
}

function scoreClass(v: number | null): string {
  if (v === null) return 'score-na'
  if (v >= 80) return 'score-good'
  if (v >= 60) return 'score-warn'
  return 'score-bad'
}

function fmtScore(v: number | null): string {
  return v === null ? '未評' : String(Math.round(v))
}

function needsBackupReminder(hasRecords: boolean, last: string | null, now = Date.now()): boolean {
  if (!hasRecords) return false
  if (!last) return true
  const t = Date.parse(last)
  return Number.isNaN(t) || now - t > REMIND_AFTER_MS
}

function downloadText(text: string, filename: string): void {
  const blob = new Blob([text], { type: 'application/json' })
  if (typeof URL.createObjectURL !== 'function') return
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

type TrendChartComponent = typeof import('../components/TrendChart').TrendChart

/** uPlot is loaded lazily so the 練唱 tab never pays for (or is broken by) the chart code. */
function useTrendChart(): { Chart: TrendChartComponent | null; failed: boolean } {
  const [state, setState] = useState<{ Chart: TrendChartComponent | null; failed: boolean }>({ Chart: null, failed: false })
  useEffect(() => {
    let alive = true
    import('../components/TrendChart')
      .then((m) => alive && setState({ Chart: m.TrendChart, failed: false }))
      .catch(() => alive && setState({ Chart: null, failed: true }))
    return () => {
      alive = false
    }
  }, [])
  return state
}

export function ProgressPage() {
  const { Chart, failed: chartFailed } = useTrendChart()
  const [loading, setLoading] = useState(true)
  const [songs, setSongs] = useState<string[]>([])
  const [song, setSong] = useState<string | null>(null)
  const [records, setRecords] = useState<SessionRecord[]>([])
  const [metric, setMetric] = useState<Metric>('total')
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [lastExport, setLastExport] = useState<string | null>(() => lastExportAt())
  const [backupMsg, setBackupMsg] = useState<{ text: string; error?: boolean } | null>(null)
  const [busy, setBusy] = useState(false)

  /** Reload song list and the selected song's records; keeps the selection when still present. */
  const reload = useCallback(async (preferred?: string | null) => {
    const names = await listSongNames()
    const pick = preferred && names.includes(preferred) ? preferred : (names[0] ?? null)
    const rows = pick === null ? [] : await listRecords(pick)
    setSongs(names)
    setSong(pick)
    setRecords(rows)
    setLoading(false)
  }, [])

  useEffect(() => {
    reload(null).catch(() => setLoading(false))
  }, [reload])

  const points = useMemo<TrendPoint[]>(
    () =>
      [...records].reverse().map((r) => ({ x: Date.parse(r.createdAt) / 1000, y: r.scores[metric] })),
    [records, metric],
  )
  const metricLabel = METRICS.find((m) => m.key === metric)!.label
  const allNull = points.length > 0 && points.every((p) => p.y === null)

  async function onDelete(id: string) {
    setConfirmId(null)
    await deleteRecord(id)
    await reload(song)
  }

  async function onExport() {
    setBusy(true)
    try {
      const json = await exportAll()
      downloadText(json, backupFileName())
      markExported()
      setLastExport(lastExportAt() ?? new Date().toISOString())
      setBackupMsg({ text: '已匯出備份檔，請存到雲端硬碟或傳給自己保存。' })
    } catch {
      setBackupMsg({ text: '匯出失敗，請再試一次。', error: true })
    } finally {
      setBusy(false)
    }
  }

  async function onImportFile(e: Event) {
    const input = e.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    setBusy(true)
    try {
      const { imported, skipped } = await importJSON(await file.text())
      setBackupMsg({
        text: `已匯入 ${imported} 筆紀錄${skipped ? `，略過 ${skipped} 筆已存在的紀錄` : ''}。`,
      })
      await reload(song)
    } catch (err) {
      setBackupMsg({ text: err instanceof Error ? err.message : '匯入失敗。', error: true })
    } finally {
      setBusy(false)
    }
  }

  const hasRecords = songs.length > 0
  const remind = needsBackupReminder(hasRecords, lastExport)

  return (
    <section class="progress-page">
      <h1 class="progress-title">進步</h1>

      {loading ? (
        <p class="progress-muted">載入中…</p>
      ) : !hasRecords ? (
        <div class="progress-empty">
          <p class="progress-empty-title">還沒有任何紀錄</p>
          <p class="progress-muted">到「練唱」錄一段並儲存，這裡就會顯示你的分數變化。</p>
        </div>
      ) : (
        <>
          <div class="progress-card">
            <label class="progress-field">
              <span class="progress-field-label">歌曲</span>
              <select
                class="progress-select"
                value={song ?? ''}
                onChange={(e) => reload((e.currentTarget as HTMLSelectElement).value)}
              >
                {songs.map((s) => (
                  <option key={s} value={s}>
                    {s || '（未命名）'}
                  </option>
                ))}
              </select>
            </label>

            <div class="progress-metrics" role="group" aria-label="趨勢項目">
              {METRICS.map((m) => (
                <button
                  key={m.key}
                  type="button"
                  class={`progress-chip${metric === m.key ? ' active' : ''}`}
                  aria-pressed={metric === m.key}
                  onClick={() => setMetric(m.key)}
                >
                  {m.label}
                </button>
              ))}
            </div>

            {records.length < 2 ? (
              <p class="progress-hint">再唱一次就能看到趨勢</p>
            ) : (
              <>
                {Chart ? (
                  <Chart points={points} label={metricLabel} />
                ) : (
                  <p class="progress-hint">{chartFailed ? '無法載入趨勢圖。' : '載入圖表中…'}</p>
                )}
                {allNull && <p class="progress-hint">這首歌的「{metricLabel}」目前都是未評。</p>}
              </>
            )}
          </div>

          <h2 class="progress-h2">練唱紀錄（{records.length}）</h2>
          <ul class="progress-list">
            {records.map((r) => (
              <li key={r.id} class="progress-item">
                <div class="progress-item-head">
                  <div>
                    <div class="progress-item-date">{formatDate(r.createdAt)}</div>
                    <div class="progress-item-meta">
                      {formatDuration(r.durationSec)} · {r.bpm === null ? '— BPM' : `${Math.round(r.bpm)} BPM`} · {r.key}
                    </div>
                  </div>
                  <div class={`progress-total ${scoreClass(r.scores.total)}`} aria-label="總分">
                    {fmtScore(r.scores.total)}
                  </div>
                </div>
                <dl class="progress-scores">
                  {ITEM_METRICS.map((m) => (
                    <div key={m.key}>
                      <dt>{m.label}</dt>
                      <dd class={scoreClass(r.scores[m.key])}>{fmtScore(r.scores[m.key])}</dd>
                    </div>
                  ))}
                </dl>
                <div class="progress-item-actions">
                  {confirmId === r.id ? (
                    <>
                      <span class="progress-confirm-text">確定刪除這筆紀錄？</span>
                      <button type="button" class="progress-btn danger" onClick={() => onDelete(r.id)}>
                        確定刪除
                      </button>
                      <button type="button" class="progress-btn" onClick={() => setConfirmId(null)}>
                        取消
                      </button>
                    </>
                  ) : (
                    <button type="button" class="progress-btn ghost" onClick={() => setConfirmId(r.id)}>
                      刪除
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <div class="progress-card progress-backup">
        <h2 class="progress-h2">備份</h2>
        {remind && (
          <p class="progress-banner" role="status">
            {lastExport ? '已超過 14 天沒有備份，' : '你還沒有備份過，'}建議現在匯出一份備份檔。
          </p>
        )}
        <p class="progress-muted">
          紀錄只存在這台裝置的瀏覽器裡。iPhone／iPad 的 Safari 會清除「未加入主畫面」網站的資料，建議先「加入主畫面」，並定期匯出備份。
        </p>
        {lastExport && <p class="progress-muted">上次匯出：{formatDate(lastExport)}</p>}
        <div class="progress-backup-actions">
          <button type="button" class="progress-btn primary" disabled={busy || !hasRecords} onClick={onExport}>
            匯出備份
          </button>
          <label class={`progress-btn${busy ? ' disabled' : ''}`}>
            匯入備份
            <input
              type="file"
              accept="application/json,.json"
              class="progress-file"
              disabled={busy}
              onChange={onImportFile}
              data-testid="import-input"
            />
          </label>
        </div>
        {backupMsg && (
          <p class={`progress-msg${backupMsg.error ? ' error' : ''}`} role={backupMsg.error ? 'alert' : 'status'}>
            {backupMsg.text}
          </p>
        )}
      </div>
    </section>
  )
}
