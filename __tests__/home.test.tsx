import { render, screen } from '@testing-library/react'
import Home from '@/app/page'
import diseases from '@/data/diseases.json'

describe('首頁 - 疾病分類列表', () => {
  it('顯示至少一種疾病', () => {
    render(<Home />)
    expect(screen.getByText(diseases[0].name)).toBeInTheDocument()
  })

  it('每種疾病有連至 /diseases/[id] 的連結', () => {
    render(<Home />)
    const links = screen.getAllByRole('link')
    const link = links.find((l) => l.getAttribute('href') === `/diseases/${diseases[0].id}`)
    expect(link).toBeDefined()
  })

  it('每張卡片顯示疾病描述', () => {
    render(<Home />)
    expect(screen.getByText(diseases[0].description)).toBeInTheDocument()
  })
})
