import { render, screen } from '@testing-library/react'
import ExerciseCard from '@/components/ExerciseCard'

const mockExercise = {
  id: 'knee-to-chest',
  name: '抱膝運動',
  gif: '/gifs/knee-to-chest.gif',
  steps: ['平躺，雙腿伸直', '將一側膝蓋抱向胸前'],
  cautions: ['若疼痛加劇，立即停止'],
  sets: '3 組',
  reps: '每組 10 次',
  equipment: '徒手',
}

describe('ExerciseCard 動作卡片', () => {
  it('顯示動作名稱', () => {
    render(<ExerciseCard exercise={mockExercise} />)
    expect(screen.getByText('抱膝運動')).toBeInTheDocument()
  })

  it('顯示 GIF 圖片', () => {
    render(<ExerciseCard exercise={mockExercise} />)
    const img = screen.getByRole('img', { name: '抱膝運動 示範動作' })
    expect(img).toHaveAttribute('src', expect.stringContaining('knee-to-chest.gif'))
  })

  it('顯示每一個步驟', () => {
    render(<ExerciseCard exercise={mockExercise} />)
    expect(screen.getByText('平躺，雙腿伸直')).toBeInTheDocument()
    expect(screen.getByText('將一側膝蓋抱向胸前')).toBeInTheDocument()
  })

  it('顯示注意事項', () => {
    render(<ExerciseCard exercise={mockExercise} />)
    expect(screen.getByText('若疼痛加劇，立即停止')).toBeInTheDocument()
  })

  it('顯示組數與器材', () => {
    render(<ExerciseCard exercise={mockExercise} />)
    expect(screen.getByText('3 組')).toBeInTheDocument()
    expect(screen.getByText('每組 10 次')).toBeInTheDocument()
    expect(screen.getByText('徒手')).toBeInTheDocument()
  })
})
