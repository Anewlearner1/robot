import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import type { AnalysisReport, SessionRecord } from '../types'
import {
  _resetForTests,
  deleteRecord,
  exportAll,
  importJSON,
  listRecords,
  listSongNames,
  newRecord,
  saveRecord,
} from './index'

function report(overrides: Partial<AnalysisReport> = {}): AnalysisReport {
  return {
    durationSec: 62.5,
    bpm: 96,
    key: { tonic: 7, mode: 'major', confidence: 0.8, fallback: false, label: 'G 大調' },
    scores: { total: 78, pitch: 82, rhythm: 70, breath: 75, vibrato: null },
    issues: [{ start: 42, end: 44, type: 'pitch', message: '0:42 長音偏低約 30 cents' }],
    pitchSummary: [
      { t: 0, midi: null },
      { t: 0.05, midi: 67.1 },
    ],
    appVersion: '0.1.0',
    ...overrides,
  }
}

function rec(song: string, createdAt: string, id?: string): SessionRecord {
  const r = newRecord(report(), song)
  return { ...r, createdAt, id: id ?? r.id }
}

beforeEach(async () => {
  await _resetForTests()
})

describe('newRecord', () => {
  it('builds a record from a report', () => {
    const r = newRecord(report(), '  小幸運  ')
    expect(r.songName).toBe('小幸運')
    expect(r.key).toBe('G 大調')
    expect(r.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(Date.parse(r.createdAt)).not.toBeNaN()
    expect(r.scores.vibrato).toBeNull()
    expect(r.bpm).toBe(96)
    expect(r.pitchSummary).toHaveLength(2)
    expect(newRecord(report(), 'a').id).not.toBe(r.id)
  })
})

describe('save / list / delete', () => {
  it('lists newest first and filters by song', async () => {
    await saveRecord(rec('A', '2026-01-01T10:00:00.000Z', 'a1'))
    await saveRecord(rec('B', '2026-01-03T10:00:00.000Z', 'b1'))
    await saveRecord(rec('A', '2026-01-02T10:00:00.000Z', 'a2'))
    expect((await listRecords()).map((r) => r.id)).toEqual(['b1', 'a2', 'a1'])
    expect((await listRecords('A')).map((r) => r.id)).toEqual(['a2', 'a1'])
    expect(await listRecords('nope')).toEqual([])
  })

  it('deletes one record', async () => {
    await saveRecord(rec('A', '2026-01-01T10:00:00.000Z', 'a1'))
    await saveRecord(rec('A', '2026-01-02T10:00:00.000Z', 'a2'))
    await deleteRecord('a1')
    expect((await listRecords()).map((r) => r.id)).toEqual(['a2'])
  })

  it('listSongNames returns distinct names, most recently used first', async () => {
    await saveRecord(rec('A', '2026-01-01T10:00:00.000Z'))
    await saveRecord(rec('B', '2026-01-02T10:00:00.000Z'))
    await saveRecord(rec('C', '2026-01-03T10:00:00.000Z'))
    await saveRecord(rec('A', '2026-01-04T10:00:00.000Z'))
    expect(await listSongNames()).toEqual(['A', 'C', 'B'])
  })
})

describe('export / import', () => {
  it('round-trips: export then import into an empty db restores identical records', async () => {
    const originals = [
      rec('A', '2026-01-01T10:00:00.000Z', 'a1'),
      { ...rec('B', '2026-01-02T10:00:00.000Z', 'b1'), bpm: null },
      rec('A', '2026-01-03T10:00:00.000Z', 'a2'),
    ]
    for (const r of originals) await saveRecord(r)
    const json = await exportAll()
    const parsed = JSON.parse(json)
    expect(parsed.app).toBe('singing-score')
    expect(parsed.format).toBe(1)
    expect(typeof parsed.exportedAt).toBe('string')
    expect(parsed.records).toHaveLength(3)

    const before = await listRecords()
    await _resetForTests()
    expect(await listRecords()).toEqual([])
    expect(await importJSON(json)).toEqual({ imported: 3, skipped: 0 })
    expect(await listRecords()).toEqual(before)
  })

  it('skips records whose id already exists', async () => {
    await saveRecord(rec('A', '2026-01-01T10:00:00.000Z', 'a1'))
    await saveRecord(rec('A', '2026-01-02T10:00:00.000Z', 'a2'))
    const json = await exportAll()
    await deleteRecord('a2')
    expect(await importJSON(json)).toEqual({ imported: 1, skipped: 1 })
    expect(await importJSON(json)).toEqual({ imported: 0, skipped: 2 })
    expect((await listRecords()).map((r) => r.id)).toEqual(['a2', 'a1'])
  })

  it('rejects malformed JSON without writing anything', async () => {
    await saveRecord(rec('A', '2026-01-01T10:00:00.000Z', 'a1'))
    await expect(importJSON('{not json')).rejects.toThrow(/JSON/)
    expect(await listRecords()).toHaveLength(1)
  })

  it('rejects wrong shapes without writing anything', async () => {
    const good = JSON.parse(await (async () => {
      await saveRecord(rec('A', '2026-01-01T10:00:00.000Z', 'x1'))
      return exportAll()
    })())
    await _resetForTests()

    await expect(importJSON('[]')).rejects.toThrow(/備份檔/)
    await expect(importJSON(JSON.stringify({ ...good, app: 'other' }))).rejects.toThrow(/備份檔/)
    await expect(importJSON(JSON.stringify({ ...good, format: 2 }))).rejects.toThrow(/格式/)
    await expect(importJSON(JSON.stringify({ ...good, records: {} }))).rejects.toThrow()

    // one valid record followed by an invalid one → nothing written
    const validNew = { ...good.records[0], id: 'new1' }
    const broken = { ...good.records[0], id: 'new2', scores: { total: 'high' } }
    await expect(importJSON(JSON.stringify({ ...good, records: [validNew, broken] }))).rejects.toThrow(/第 2 筆/)
    const badIssue = { ...good.records[0], id: 'new3', issues: [{ start: 0, end: 1, type: 'tone', message: 'x' }] }
    await expect(importJSON(JSON.stringify({ ...good, records: [badIssue] }))).rejects.toThrow()
    const missingField = { ...good.records[0], id: 'new4' }
    delete missingField.pitchSummary
    await expect(importJSON(JSON.stringify({ ...good, records: [missingField] }))).rejects.toThrow()

    expect(await listRecords()).toEqual([])
  })

  it('drops unknown extra fields on import', async () => {
    await saveRecord(rec('A', '2026-01-01T10:00:00.000Z', 'a1'))
    const file = JSON.parse(await exportAll())
    file.records[0].extra = 'junk'
    await _resetForTests()
    await importJSON(JSON.stringify(file))
    const [r] = await listRecords()
    expect('extra' in r).toBe(false)
  })
})
