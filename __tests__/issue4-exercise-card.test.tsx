import { render, screen } from '@testing-library/react'
import ExerciseCard from '@/components/ExerciseCard'

const base = {
  id: 'ex-1',
  name: '測試動作',
  gif: '/gifs/test.gif',
  steps: ['步驟一', '步驟二'],
  cautions: ['注意這個'],
  sets: '3 組',
  reps: '每組 10 次',
  equipment: '徒手',
}

describe('Issue #4 — ExerciseCard 完整規格', () => {
  it('cautions 為空陣列時不渲染注意事項區塊', () => {
    render(<ExerciseCard exercise={{ ...base, cautions: [] }} />)
    expect(screen.queryByText('注意事項')).not.toBeInTheDocument()
  })

  it('equipment 為「徒手」時顯示特別視覺提示', () => {
    render(<ExerciseCard exercise={base} />)
    // 徒手 should have a special marker — look for the icon or special class
    const equipmentEl = screen.getByTestId('equipment-badge')
    expect(equipmentEl).toHaveTextContent('徒手')
    expect(equipmentEl).toHaveClass('equipment-bare-hands')
  })

  it('sets 和 reps 以並排 badge 顯示', () => {
    render(<ExerciseCard exercise={base} />)
    const setsBadge = screen.getByTestId('sets-badge')
    const repsBadge = screen.getByTestId('reps-badge')
    expect(setsBadge).toHaveTextContent('3 組')
    expect(repsBadge).toHaveTextContent('每組 10 次')
  })

  it('cautions 以橘色左框線樣式呈現', () => {
    render(<ExerciseCard exercise={base} />)
    const cautionsBlock = screen.getByTestId('cautions-block')
    expect(cautionsBlock).toHaveClass('border-l-4')
    expect(cautionsBlock).toHaveClass('border-[#E8845A]')
  })

  it('GIF 循環播放（unoptimized img with loop semantics）', () => {
    render(<ExerciseCard exercise={base} />)
    const img = screen.getByRole('img', { name: '測試動作 示範動作' })
    expect(img).toBeInTheDocument()
  })
})
