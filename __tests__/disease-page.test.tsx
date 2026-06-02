import { render, screen } from '@testing-library/react'
import PhasesTabs from '@/components/PhasesTabs'

const mockPhases = {
  acute: [
    {
      id: 'knee-to-chest',
      name: '抱膝運動',
      gif: '/gifs/knee-to-chest.gif',
      steps: ['平躺，雙腿伸直', '將一側膝蓋抱向胸前'],
      cautions: ['若疼痛加劇，立即停止'],
      sets: '3 組',
      reps: '每組 10 次',
      equipment: '徒手',
    },
  ],
  recovery: [],
  strengthening: [],
}

describe('PhasesTabs 三階段分頁', () => {
  it('預設顯示「急性期」按鈕', () => {
    render(<PhasesTabs phases={mockPhases} />)
    expect(screen.getByText('急性期')).toBeInTheDocument()
    expect(screen.getByText('恢復期')).toBeInTheDocument()
    expect(screen.getByText('強化期')).toBeInTheDocument()
  })

  it('預設顯示急性期的動作', () => {
    render(<PhasesTabs phases={mockPhases} />)
    expect(screen.getByText('抱膝運動')).toBeInTheDocument()
  })
})

describe('Layout footer 免責聲明', () => {
  it('每個頁面都有免責聲明文字', async () => {
    const { default: RootLayout } = await import('@/app/layout')
    render(<RootLayout>
      <div>test content</div>
    </RootLayout>)
    expect(
      screen.getByText(/本網站內容僅供衛教參考/)
    ).toBeInTheDocument()
  })
})
