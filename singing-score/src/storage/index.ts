/**
 * Local history storage (PRD F6/F8): Dexie over IndexedDB, plus JSON backup export/import.
 * Audio is never stored — only SessionRecord metadata, scores, issues and the down-sampled pitch curve.
 */
import Dexie, { type Table } from 'dexie'
import type { AnalysisReport, Issue, PitchPoint, Scores, SessionRecord } from '../types'

export const DB_NAME = 'singing-score'
export const BACKUP_APP = 'singing-score'
export const BACKUP_FORMAT = 1
const LAST_EXPORT_KEY = 'singing-score:lastExportAt'

class SingingDB extends Dexie {
  records!: Table<SessionRecord, string>
  constructor() {
    super(DB_NAME)
    this.version(1).stores({ records: 'id, songName, createdAt' })
  }
}

let dbInstance: SingingDB | null = null
function db(): SingingDB {
  if (!dbInstance) dbInstance = new SingingDB()
  return dbInstance
}

/** Test helper: close and forget the connection (e.g. before deleting the database). */
export async function _resetForTests(): Promise<void> {
  if (dbInstance) {
    dbInstance.close()
    dbInstance = null
  }
  await Dexie.delete(DB_NAME)
}

function uuid(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  const bytes = new Uint8Array(16)
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes)
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const h = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

export function newRecord(report: AnalysisReport, songName: string): SessionRecord {
  return {
    id: uuid(),
    songName: songName.trim(),
    createdAt: new Date().toISOString(),
    durationSec: report.durationSec,
    bpm: report.bpm,
    key: report.key.label,
    scores: { ...report.scores },
    issues: report.issues.map((i) => ({ ...i })),
    pitchSummary: report.pitchSummary.map((p) => ({ ...p })),
    appVersion: report.appVersion,
  }
}

export async function saveRecord(r: SessionRecord): Promise<void> {
  await db().records.put(r)
}

/** Newest first; optionally only one song. */
export async function listRecords(songName?: string): Promise<SessionRecord[]> {
  const t = db().records
  const rows = songName === undefined ? await t.toArray() : await t.where('songName').equals(songName).toArray()
  return rows.sort(byNewest)
}

function byNewest(a: SessionRecord, b: SessionRecord): number {
  return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0
}

export async function deleteRecord(id: string): Promise<void> {
  await db().records.delete(id)
}

/** Distinct song names, most recently used first. */
export async function listSongNames(): Promise<string[]> {
  const rows = await db().records.orderBy('createdAt').reverse().toArray()
  const seen = new Set<string>()
  const out: string[] = []
  for (const r of rows) {
    if (!seen.has(r.songName)) {
      seen.add(r.songName)
      out.push(r.songName)
    }
  }
  return out
}

export interface BackupFile {
  app: typeof BACKUP_APP
  format: typeof BACKUP_FORMAT
  exportedAt: string
  records: SessionRecord[]
}

export async function exportAll(): Promise<string> {
  const records = (await db().records.toArray()).sort((a, b) => -byNewest(a, b))
  const file: BackupFile = { app: BACKUP_APP, format: BACKUP_FORMAT, exportedAt: new Date().toISOString(), records }
  return JSON.stringify(file, null, 2)
}

// ---------- strict validation of imported data ----------

const SCORE_KEYS = ['pitch', 'rhythm', 'breath', 'vibrato'] as const

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isNumOrNull = (v: unknown): v is number | null => v === null || isNum(v)
const isStr = (v: unknown): v is string => typeof v === 'string'

function validScores(v: unknown): v is Scores {
  if (!isObj(v)) return false
  return (['total', ...SCORE_KEYS] as const).every((k) => isNumOrNull(v[k]))
}

function validIssue(v: unknown): v is Issue {
  return (
    isObj(v) &&
    isNum(v.start) &&
    isNum(v.end) &&
    isStr(v.message) &&
    (SCORE_KEYS as readonly unknown[]).includes(v.type)
  )
}

function validPoint(v: unknown): v is PitchPoint {
  return isObj(v) && isNum(v.t) && isNumOrNull(v.midi)
}

function validRecord(v: unknown): v is SessionRecord {
  return (
    isObj(v) &&
    isStr(v.id) &&
    v.id.length > 0 &&
    isStr(v.songName) &&
    isStr(v.createdAt) &&
    !Number.isNaN(Date.parse(v.createdAt)) &&
    isNum(v.durationSec) &&
    isNumOrNull(v.bpm) &&
    isStr(v.key) &&
    validScores(v.scores) &&
    Array.isArray(v.issues) &&
    v.issues.every(validIssue) &&
    Array.isArray(v.pitchSummary) &&
    v.pitchSummary.every(validPoint) &&
    isStr(v.appVersion)
  )
}

/** Keep only the contract fields, so unknown extra keys in a backup never reach the db. */
function clean(r: SessionRecord): SessionRecord {
  const s = r.scores
  return {
    id: r.id,
    songName: r.songName,
    createdAt: r.createdAt,
    durationSec: r.durationSec,
    bpm: r.bpm,
    key: r.key,
    scores: { total: s.total, pitch: s.pitch, rhythm: s.rhythm, breath: s.breath, vibrato: s.vibrato },
    issues: r.issues.map(({ start, end, type, message }) => ({ start, end, type, message })),
    pitchSummary: r.pitchSummary.map(({ t, midi }) => ({ t, midi })),
    appVersion: r.appVersion,
  }
}

/**
 * Import a backup produced by exportAll(). The whole file is validated before anything is written;
 * records whose id already exists are skipped; all writes happen in one transaction.
 */
export async function importJSON(text: string): Promise<{ imported: number; skipped: number }> {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('檔案不是有效的 JSON，無法匯入。')
  }
  if (!isObj(data) || data.app !== BACKUP_APP) {
    throw new Error('這不是「唱歌評分」的備份檔。')
  }
  if (data.format !== BACKUP_FORMAT) {
    throw new Error(`不支援的備份格式版本（${String(data.format)}），請更新 App 後再試。`)
  }
  if (!Array.isArray(data.records)) {
    throw new Error('備份檔內容不完整：找不到紀錄清單。')
  }
  const records = data.records as unknown[]
  const bad = records.findIndex((r) => !validRecord(r))
  if (bad !== -1) {
    throw new Error(`備份檔第 ${bad + 1} 筆紀錄格式錯誤，未匯入任何資料。`)
  }
  const incoming = (records as SessionRecord[]).map(clean)

  const t = db().records
  return db().transaction('rw', t, async () => {
    const ids = [...new Set(incoming.map((r) => r.id))]
    const existing = await t.bulkGet(ids)
    const present = new Set(ids.filter((_, i) => existing[i] !== undefined))
    const toAdd: SessionRecord[] = []
    let skipped = 0
    for (const r of incoming) {
      if (present.has(r.id)) {
        skipped++
        continue
      }
      present.add(r.id) // duplicates inside the same file count once
      toAdd.push(r)
    }
    if (toAdd.length) await t.bulkAdd(toAdd)
    return { imported: toAdd.length, skipped }
  })
}

// ---------- backup reminder ----------

export function lastExportAt(): string | null {
  try {
    return localStorage.getItem(LAST_EXPORT_KEY)
  } catch {
    return null
  }
}

export function markExported(): void {
  try {
    localStorage.setItem(LAST_EXPORT_KEY, new Date().toISOString())
  } catch {
    // storage unavailable (private mode etc.) — reminder will simply keep showing
  }
}
