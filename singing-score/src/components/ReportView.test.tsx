// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReportData } from './ReportView'
import { ReportView } from './ReportView'
import { formatClock, formatTimer, midiToName } from './format'

vi.mock('./PitchChart', () => ({
  PitchChart: (p: { points: unknown[]; issues?: unknown[] }) => (
    <div data-testid="pitch-chart" data-points={p.points.length} data-issues={p.issues?.length ?? 0} />
  ),
}))

afterEach(cleanup)

const base: ReportData = {
  scores: { total: 82.4, pitch: 78, rhythm: null, breath: null, vibrato: null },
  issues: [],
  pitchSummary: [
    { t: 0, midi: 60 },
    { t: 0.05, midi: null },
    { t: 0.1, midi: 62 },
  ],
  durationSec: 95,
  bpm: null,
  keyLabel: 'G 大調',
}

describe('format helpers', () => {
  it('formats clock, timer and note names', () => {
    expect(formatClock(42.7)).toBe('0:42')
    expect(formatClock(75)).toBe('1:15')
    expect(formatTimer(5)).toBe('00:05')
    expect(formatTimer(180)).toBe('03:00')
    expect(midiToName(60)).toBe('C4')
    expect(midiToName(69.2)).toBe('A4')
    expect(midiToName(61)).toBe('C#4')
  })
})

describe('ReportView', () => {
  it('shows the rounded total, scored items and 未評 with reasons for null items', () => {
    render(<ReportView data={base} />)
    expect(screen.getByText('82')).toBeTruthy()
    expect(screen.getByText('78')).toBeTruthy()
    expect(screen.getAllByText('未評')).toHaveLength(3)
    expect(screen.getByText('未設定 BPM')).toBeTruthy()
    expect(screen.getByText('沒有長音')).toBeTruthy()
    expect(screen.getByText('未偵測到顫音（不扣分）')).toBeTruthy()
    expect(screen.queryByText('有效音符太少')).toBeNull()
    expect(screen.getByText('G 大調')).toBeTruthy()
    expect(screen.getByTestId('pitch-chart').dataset.points).toBe('3')
  })

  it('shows 音準 reason and an unscored total when everything is null', () => {
    const data: ReportData = {
      ...base,
      scores: { total: null, pitch: null, rhythm: 70, breath: null, vibrato: null },
      bpm: 96,
    }
    render(<ReportView data={data} />)
    expect(screen.getAllByText('未評')).toHaveLength(4) // total + 3 items
    expect(screen.getByText('有效音符太少')).toBeTruthy()
    expect(screen.queryByText('未設定 BPM')).toBeNull()
    expect(screen.getByText('96 BPM')).toBeTruthy()
  })

  it('renders at most 3 issue cards with m:ss–m:ss times and shades them on the chart', () => {
    const data: ReportData = {
      ...base,
      issues: [
        { start: 42.2, end: 45.9, type: 'pitch', message: '長音偏低約 30 cents' },
        { start: 61, end: 64, type: 'breath', message: '尾音氣不足' },
        { start: 125, end: 130.5, type: 'rhythm', message: '搶拍' },
        { start: 150, end: 152, type: 'pitch', message: '第四個不顯示' },
      ],
    }
    render(<ReportView data={data} />)
    const cards = document.querySelectorAll('.issue-card')
    expect(cards).toHaveLength(3)
    expect(screen.getByText('0:42–0:45')).toBeTruthy()
    expect(screen.getByText('1:01–1:04')).toBeTruthy()
    expect(screen.getByText('2:05–2:10')).toBeTruthy()
    expect(screen.getByText('長音偏低約 30 cents')).toBeTruthy()
    expect(screen.queryByText('第四個不顯示')).toBeNull()
    expect(screen.getByTestId('pitch-chart').dataset.issues).toBe('3')
  })
})
