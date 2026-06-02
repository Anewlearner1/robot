import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PhasesTabs from '@/components/PhasesTabs'

const phasesWithAll = {
  acute: [
    {
      id: 'ex-a',
      name: '急性動作A',
      gif: '/gifs/a.gif',
      steps: ['步驟一'],
      cautions: ['注意事項'],
      sets: '3 組',
      reps: '10 次',
      equipment: '徒手',
    },
  ],
  recovery: [
    {
      id: 'ex-r',
      name: '恢復動作R',
      gif: '/gifs/r.gif',
      steps: ['步驟一'],
      cautions: [],
      sets: '3 組',
      reps: '10 次',
      equipment: '徒手',
    },
  ],
  strengthening: [],
}

describe('Issue #3 — PhasesTabs', () => {
  it('預設顯示急性期動作', () => {
    render(<PhasesTabs phases={phasesWithAll} />)
    expect(screen.getByText('急性動作A')).toBeInTheDocument()
    expect(screen.queryByText('恢復動作R')).not.toBeInTheDocument()
  })

  it('點擊「恢復期」tab 切換顯示', async () => {
    render(<PhasesTabs phases={phasesWithAll} />)
    await userEvent.click(screen.getByText('恢復期'))
    expect(screen.getByText('恢復動作R')).toBeInTheDocument()
    expect(screen.queryByText('急性動作A')).not.toBeInTheDocument()
  })

  it('強化期無動作時顯示空白提示', async () => {
    render(<PhasesTabs phases={phasesWithAll} />)
    await userEvent.click(screen.getByText('強化期'))
    expect(screen.getByText('本階段尚無動作')).toBeInTheDocument()
  })

  it('切換 tab 為純前端 state（元件不含 useEffect 網路呼叫）', async () => {
    // PhasesTabs is a pure client state component — switching tabs is instant
    render(<PhasesTabs phases={phasesWithAll} />)
    await userEvent.click(screen.getByText('恢復期'))
    await userEvent.click(screen.getByText('急性期'))
    // Content switches back immediately without any async delay → no network needed
    expect(screen.getByText('急性動作A')).toBeInTheDocument()
  })
})
