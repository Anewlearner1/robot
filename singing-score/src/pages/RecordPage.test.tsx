// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AnalysisReport, RecordedAudio, SessionRecord } from '../types'

const m = vi.hoisted(() => {
  class MicPermissionError extends Error {}
  const audio = { samples: new Float32Array(16), sampleRate: 48000 }
  const recorder = {
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => audio),
    cancel: vi.fn(),
    recording: false,
  }
  return {
    MicPermissionError,
    audio,
    recorder,
    createRecorder: vi.fn((_opts?: unknown) => recorder),
    analyzeInWorker: vi.fn(),
    saveRecord: vi.fn(async (_r: unknown) => {}),
    listSongNames: vi.fn(async () => ['小幸運', '告白氣球']),
    newRecord: vi.fn(),
  }
})

vi.mock('../audio', () => ({
  MicPermissionError: m.MicPermissionError,
  createRecorder: m.createRecorder,
  analyzeInWorker: m.analyzeInWorker,
  createTapTempo: () => {
    let n = 0
    return {
      tap: () => (++n >= 4 ? 100 : null),
      reset: () => (n = 0),
      get count() {
        return n
      },
    }
  },
}))

vi.mock('../storage', () => ({
  saveRecord: m.saveRecord,
  listSongNames: m.listSongNames,
  newRecord: m.newRecord,
}))

vi.mock('../components/PitchChart', () => ({ PitchChart: () => <div data-testid="pitch-chart" /> }))

import { RecordPage } from './RecordPage'

const report: AnalysisReport = {
  durationSec: 30,
  bpm: null,
  key: { tonic: 7, mode: 'major', confidence: 0.8, fallback: false, label: 'G 大調' },
  scores: { total: 77, pitch: 77, rhythm: null, breath: null, vibrato: null },
  issues: [{ start: 12, end: 14.5, type: 'pitch', message: '這句偏高' }],
  pitchSummary: [{ t: 0, midi: 67 }],
  appVersion: 'test',
}

beforeEach(() => {
  m.recorder.start.mockImplementation(async () => {})
  m.analyzeInWorker.mockImplementation(async (_a: RecordedAudio, bpm: number | null) => ({ ...report, bpm }))
  m.newRecord.mockImplementation(
    (r: AnalysisReport, songName: string): SessionRecord => ({
      id: 'id1',
      songName,
      createdAt: '2026-10-07T00:00:00Z',
      durationSec: r.durationSec,
      bpm: r.bpm,
      key: r.key.label,
      scores: r.scores,
      issues: r.issues,
      pitchSummary: r.pitchSummary,
      appVersion: r.appVersion,
    }),
  )
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

async function goToTempo(name = '晴天') {
  render(<RecordPage />)
  const next = screen.getByRole('button', { name: '下一步' }) as HTMLButtonElement
  expect(next.disabled).toBe(true) // song name required
  fireEvent.input(screen.getByLabelText('歌名'), { target: { value: name } })
  expect(next.disabled).toBe(false)
  fireEvent.click(next)
  await screen.findByRole('button', { name: '開始錄音' })
}

describe('RecordPage', () => {
  it('suggests recent song names', async () => {
    render(<RecordPage />)
    fireEvent.click(await screen.findByRole('button', { name: '告白氣球' }))
    expect((screen.getByLabelText('歌名') as HTMLInputElement).value).toBe('告白氣球')
  })

  it('happy path: name → record → stop → report → save', async () => {
    await goToTempo()
    expect(screen.getByText('請戴耳機聽伴奏，或清唱')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '開始錄音' }))
    const stop = (await screen.findByRole('button', { name: '停止錄音' })) as HTMLButtonElement
    await waitFor(() => expect(stop.disabled).toBe(false))
    expect(m.createRecorder).toHaveBeenCalledWith(expect.objectContaining({ maxSec: 180 }))
    expect(screen.getByText('00:00')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '開始錄音' })).toBeNull()

    fireEvent.click(stop)
    await screen.findByText('G 大調')
    expect(m.recorder.stop).toHaveBeenCalled()
    expect(m.analyzeInWorker).toHaveBeenCalledWith(m.audio, null)
    expect(screen.getByText('這句偏高')).toBeTruthy()
    expect(screen.getByText('0:12–0:14')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '儲存紀錄' }))
    await screen.findByText('已儲存紀錄')
    expect(m.newRecord).toHaveBeenCalledWith(expect.objectContaining({ scores: report.scores }), '晴天')
    expect(m.saveRecord).toHaveBeenCalledWith(expect.objectContaining({ songName: '晴天' }))
    expect(screen.getByRole('link', { name: '查看進步' }).getAttribute('href')).toBe('#/progress')

    // 再唱一次 keeps the song name.
    fireEvent.click(screen.getByRole('button', { name: '再唱一次' }))
    await screen.findByRole('button', { name: '開始錄音' })
    expect(screen.getByRole('heading', { name: '晴天' })).toBeTruthy()
  })

  it('passes tapped BPM to analysis and keeps it after 不儲存', async () => {
    await goToTempo()
    const tap = screen.getByRole('button', { name: /點擊打拍/ })
    for (let i = 0; i < 4; i++) fireEvent.click(tap)
    expect(screen.getByText('100 BPM')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '開始錄音' }))
    const stop = (await screen.findByRole('button', { name: '停止錄音' })) as HTMLButtonElement
    await waitFor(() => expect(stop.disabled).toBe(false))
    fireEvent.click(stop)
    await screen.findByText('G 大調')
    expect(m.analyzeInWorker).toHaveBeenCalledWith(m.audio, 100)

    fireEvent.click(screen.getByRole('button', { name: '不儲存' }))
    await screen.findByRole('button', { name: '開始錄音' })
    expect(m.saveRecord).not.toHaveBeenCalled()
    expect(screen.getByText('100 BPM')).toBeTruthy()
  })

  it('analyzes automatically when the recorder hits the 3:00 cap', async () => {
    await goToTempo()
    fireEvent.click(screen.getByRole('button', { name: '開始錄音' }))
    await screen.findByRole('button', { name: '停止錄音' })
    const opts = m.createRecorder.mock.calls[0][0] as { onAutoStop: (a: RecordedAudio) => void }
    opts.onAutoStop(m.audio)
    await screen.findByText('G 大調')
    expect(m.recorder.stop).not.toHaveBeenCalled()
  })

  it('shows how to allow the mic on MicPermissionError', async () => {
    m.recorder.start.mockImplementation(async () => {
      throw new m.MicPermissionError('denied')
    })
    await goToTempo()
    fireEvent.click(screen.getByRole('button', { name: '開始錄音' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('請允許麥克風權限')
    expect(alert.textContent).toContain('設定 › Safari › 麥克風')
    fireEvent.click(screen.getByRole('button', { name: '返回' }))
    await screen.findByRole('button', { name: '開始錄音' })
  })
})
