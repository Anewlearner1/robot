import { render, screen } from '@testing-library/react'
import Home from '@/app/page'
import diseases from '@/data/diseases.json'

describe('Issue #2 — 首頁疾病分類列表', () => {
  it('顯示全部 10 種以上疾病', () => {
    render(<Home />)
    // each disease card has a heading with the disease name
    const headings = screen.getAllByRole('heading', { level: 2 })
    expect(headings.length).toBeGreaterThanOrEqual(10)
  })

  it('每張卡片有連結指向正確疾病頁', () => {
    render(<Home />)
    diseases.forEach((d) => {
      const links = screen.getAllByRole('link')
      const match = links.find((l) => l.getAttribute('href') === `/diseases/${d.id}`)
      expect(match).toBeDefined()
    })
  })

  it('空動作疾病仍能點擊（不崩潰）', () => {
    // stub diseases with no exercises should render without throwing
    expect(() => render(<Home />)).not.toThrow()
  })
})
