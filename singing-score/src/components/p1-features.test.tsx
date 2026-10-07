// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FirstRunTips } from './FirstRunTips'
import type { ReportData } from './ReportView'
import { ReportView } from './ReportView'

vi.mock('./PitchChart', () => ({
  PitchChart: (p: { zoom?: { start: number; end: number } | null }) => (
    <div data-testid="pitch-chart" data-zoom={p.zoom ? `${p.zoom.start}-${p.zoom.end}` : 'none'} />
  ),
}))

afterEach(cleanup)

describe('F11 tap an issue to zoom the pitch chart', () => {
  const data: ReportData = {
    scores: { total: 70, pitch: 60, rhythm: null, breath: 80, vibrato: null },
    issues: [
      { start: 12, end: 15, type: 'pitch', message: '0:12 這段偏低約 35 cents' },
      { start: 40, end: 43, type: 'breath', message: '0:40 長音音量起伏大（約 30%）' },
    ],
    pitchSummary: [{ t: 0, midi: 60 }],
    durationSec: 60,
    bpm: null,
    keyLabel: 'C 大調',
  }

  it('zooms to the tapped issue, toggles off, and resets with 顯示全部', () => {
    render(<ReportView data={data} />)
    const chart = screen.getByTestId('pitch-chart')
    expect(chart.dataset.zoom).toBe('none')
    expect(screen.queryByText('顯示全部')).toBeNull()

    const [first, second] = screen.getAllByRole('button', { pressed: false })
    fireEvent.click(second)
    expect(chart.dataset.zoom).toBe('40-43')
    expect(second.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('放大顯示 0:40–0:43')).toBeTruthy()

    fireEvent.click(first)
    expect(chart.dataset.zoom).toBe('12-15')
    fireEvent.click(first)
    expect(chart.dataset.zoom).toBe('none')

    fireEvent.click(first)
    fireEvent.click(screen.getByText('顯示全部'))
    expect(chart.dataset.zoom).toBe('none')
  })
})

describe('F10 first-run tips', () => {
  beforeEach(() => localStorage.clear())

  it('shows headphone and home-screen tips until dismissed, then stays hidden', () => {
    const { unmount } = render(<FirstRunTips />)
    expect(screen.getByText(/戴耳機或清唱/)).toBeTruthy()
    expect(screen.getByText(/加入主畫面以保存紀錄/)).toBeTruthy()
    fireEvent.click(screen.getByText('知道了'))
    expect(screen.queryByText(/戴耳機或清唱/)).toBeNull()
    unmount()

    render(<FirstRunTips />)
    expect(screen.queryByText(/戴耳機或清唱/)).toBeNull()
  })
})
