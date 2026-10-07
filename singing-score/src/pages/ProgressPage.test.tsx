// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionRecord } from '../types'
import { _resetForTests, listRecords, saveRecord } from '../storage'
import { ProgressPage, backupFileName } from './ProgressPage'

vi.mock('../components/TrendChart', () => ({
  TrendChart: (props: { points: { x: number; y: number | null }[]; label: string }) => (
    <div data-testid="trend" data-label={props.label} data-values={JSON.stringify(props.points.map((p) => p.y))} />
  ),
}))

function rec(id: string, song: string, createdAt: string, scores: Partial<SessionRecord['scores']> = {}): SessionRecord {
  return {
    id,
    songName: song,
    createdAt,
    durationSec: 75,
    bpm: 92,
    key: 'G 大調',
    scores: { total: 70, pitch: 80, rhythm: 60, breath: 50, vibrato: null, ...scores },
    issues: [],
    pitchSummary: [],
    appVersion: '0.1.0',
  }
}

beforeEach(async () => {
  await _resetForTests()
  try {
    localStorage.clear()
  } catch {
    /* ignore */
  }
})
afterEach(() => cleanup())

describe('ProgressPage', () => {
  it('shows the empty state when there are no records', async () => {
    render(<ProgressPage />)
    expect(await screen.findByText('還沒有任何紀錄')).toBeTruthy()
    expect(screen.queryByTestId('trend')).toBeNull()
  })

  it('shows the "sing again" message with fewer than 2 records for the song', async () => {
    await saveRecord(rec('a1', '小幸運', '2026-01-01T10:00:00.000Z'))
    render(<ProgressPage />)
    expect(await screen.findByText('再唱一次就能看到趨勢')).toBeTruthy()
    expect(screen.queryByTestId('trend')).toBeNull()
    expect(screen.getByText('未評')).toBeTruthy()
  })

  it('defaults to the most recent song and switches metric', async () => {
    await saveRecord(rec('a1', 'A', '2026-01-01T10:00:00.000Z', { total: 60, pitch: 61, vibrato: null }))
    await saveRecord(rec('a2', 'A', '2026-01-02T10:00:00.000Z', { total: 70, pitch: 71, vibrato: 40 }))
    await saveRecord(rec('b1', 'B', '2025-12-01T10:00:00.000Z'))
    render(<ProgressPage />)
    const chart = await screen.findByTestId('trend')
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('A')
    // oldest → newest on the x axis
    expect(chart.getAttribute('data-values')).toBe('[60,70]')
    expect(chart.getAttribute('data-label')).toBe('總分')

    fireEvent.click(screen.getByRole('button', { name: '音準' }))
    await waitFor(() => expect(screen.getByTestId('trend').getAttribute('data-values')).toBe('[61,71]'))
    fireEvent.click(screen.getByRole('button', { name: '顫音' }))
    await waitFor(() => expect(screen.getByTestId('trend').getAttribute('data-values')).toBe('[null,40]'))
    expect(screen.getByTestId('trend').getAttribute('data-label')).toBe('顫音')

    // switching song filters history
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'B' } })
    expect(await screen.findByText('再唱一次就能看到趨勢')).toBeTruthy()
    expect(screen.getByText('練唱紀錄（1）')).toBeTruthy()
  })

  it('deletes a record after confirmation', async () => {
    await saveRecord(rec('a1', 'A', '2026-01-01T10:00:00.000Z'))
    await saveRecord(rec('a2', 'A', '2026-01-02T10:00:00.000Z'))
    render(<ProgressPage />)
    await screen.findByText('練唱紀錄（2）')
    fireEvent.click(screen.getAllByRole('button', { name: '刪除' })[0])
    // cancel first
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(await listRecords()).toHaveLength(2)
    fireEvent.click(screen.getAllByRole('button', { name: '刪除' })[0])
    fireEvent.click(screen.getByRole('button', { name: '確定刪除' }))
    await screen.findByText('練唱紀錄（1）')
    expect((await listRecords()).map((r) => r.id)).toEqual(['a1'])
    expect(screen.getByText('再唱一次就能看到趨勢')).toBeTruthy()
  })

  it('shows a backup reminder when never exported, and imports a backup file', async () => {
    await saveRecord(rec('a1', 'A', '2026-01-01T10:00:00.000Z'))
    render(<ProgressPage />)
    expect(await screen.findByText(/你還沒有備份過/)).toBeTruthy()

    const backup = JSON.stringify({
      app: 'singing-score',
      format: 1,
      exportedAt: '2026-02-01T00:00:00.000Z',
      records: [rec('a1', 'A', '2026-01-01T10:00:00.000Z'), rec('a3', 'A', '2026-01-03T10:00:00.000Z')],
    })
    const file = new File([backup], 'b.json', { type: 'application/json' })
    if (typeof file.text !== 'function') Object.defineProperty(file, 'text', { value: async () => backup })
    fireEvent.change(screen.getByTestId('import-input'), { target: { files: [file] } })
    expect(await screen.findByText('已匯入 1 筆紀錄，略過 1 筆已存在的紀錄。')).toBeTruthy()
    expect(await screen.findByText('練唱紀錄（2）')).toBeTruthy()

    const bad = new File(['nope'], 'x.json')
    if (typeof bad.text !== 'function') Object.defineProperty(bad, 'text', { value: async () => 'nope' })
    fireEvent.change(screen.getByTestId('import-input'), { target: { files: [bad] } })
    expect((await screen.findByRole('alert')).textContent).toMatch(/JSON/)
  })

  it('names the backup file by date', () => {
    expect(backupFileName(new Date(2026, 9, 7))).toBe('singing-score-backup-20261007.json')
  })
})
