import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SearchBar from '@/components/SearchBar'

// Mock router for Link
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => '/',
}))

describe('Issue #5 — SearchBar 模糊搜尋', () => {
  it('顯示搜尋框', () => {
    render(<SearchBar />)
    expect(screen.getByRole('searchbox')).toBeInTheDocument()
  })

  it('輸入「膝蓋痛」能找到「膝關節炎」（別名搜尋）', async () => {
    render(<SearchBar />)
    await userEvent.type(screen.getByRole('searchbox'), '膝蓋痛')
    await waitFor(() => {
      expect(screen.getByText(/膝關節炎/)).toBeInTheDocument()
    })
  })

  it('輸入關鍵字後即時顯示結果（不需按 Enter）', async () => {
    render(<SearchBar />)
    await userEvent.type(screen.getByRole('searchbox'), '腰')
    await waitFor(() => {
      expect(screen.getByRole('listbox')).toBeInTheDocument()
    })
  })

  it('無結果時顯示「找不到相關內容」', async () => {
    render(<SearchBar />)
    await userEvent.type(screen.getByRole('searchbox'), 'ZZZZZ不存在')
    await waitFor(() => {
      expect(screen.getByText('找不到相關內容')).toBeInTheDocument()
    })
  })

  it('按 Esc 關閉搜尋 overlay', async () => {
    render(<SearchBar />)
    await userEvent.type(screen.getByRole('searchbox'), '腰')
    await waitFor(() => screen.getByRole('listbox'))
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
})
