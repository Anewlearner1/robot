// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/preact'
import { useState } from 'preact/hooks'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TempoPanel } from './TempoPanel'

const tapper = vi.hoisted(() => {
  let count = 0
  return {
    tap: vi.fn(() => {
      count += 1
      return count >= 4 ? 120 : null
    }),
    reset: vi.fn(() => {
      count = 0
    }),
    get count() {
      return count
    },
  }
})

vi.mock('../audio', () => ({ createTapTempo: () => tapper }))

afterEach(() => {
  cleanup()
  tapper.reset()
})

function Harness() {
  const [bpm, setBpm] = useState<number | null>(null)
  return <TempoPanel bpm={bpm} onBpmChange={setBpm} />
}

describe('TempoPanel', () => {
  it('shows tap count, then BPM after 4 taps; ± fine-tunes; 跳過 clears', () => {
    render(<Harness />)
    const tap = screen.getByRole('button', { name: /點擊打拍/ })
    fireEvent.click(tap)
    fireEvent.click(tap)
    expect(screen.getByText('已點 2 下')).toBeTruthy()
    expect(screen.queryByText(/BPM$/)).toBeNull()
    fireEvent.click(tap)
    fireEvent.click(tap)
    expect(screen.getByText('已點 4 下')).toBeTruthy()
    expect(screen.getByText('120 BPM')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'BPM 加 1' }))
    expect(screen.getByText('121 BPM')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'BPM 減 1' }))
    fireEvent.click(screen.getByRole('button', { name: 'BPM 減 1' }))
    expect(screen.getByText('119 BPM')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '跳過（不評節奏）' }))
    expect(screen.getByText('未設定')).toBeTruthy()
    expect(tapper.reset).toHaveBeenCalled()
  })
})
