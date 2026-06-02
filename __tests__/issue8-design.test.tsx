import { render, screen } from '@testing-library/react'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => '/',
}))

describe('Issue #8 — 視覺設計系統', () => {
  it('footer 免責聲明存在且包含 text-xs class（≥12px）', async () => {
    const { default: RootLayout } = await import('@/app/layout')
    render(<RootLayout><div /></RootLayout>)
    const footer = screen.getByText(/本網站內容僅供衛教參考/)
    expect(footer).toBeInTheDocument()
    expect(footer.className).toMatch(/text-xs/)
  })

  it('body 帶有米白背景 design token class', async () => {
    const { default: RootLayout } = await import('@/app/layout')
    const { container } = render(<RootLayout><div /></RootLayout>)
    const body = container.querySelector('body')
    expect(body?.className).toContain('bg-[#FAF8F5]')
  })

  it('header logo 連結指向首頁', async () => {
    const { default: RootLayout } = await import('@/app/layout')
    render(<RootLayout><div /></RootLayout>)
    const homeLink = screen.getByRole('link', { name: '復健運動' })
    expect(homeLink).toHaveAttribute('href', '/')
  })

  it('header 為 sticky（固定在頂部）', async () => {
    const { default: RootLayout } = await import('@/app/layout')
    const { container } = render(<RootLayout><div /></RootLayout>)
    const header = container.querySelector('header')
    expect(header?.className).toContain('sticky')
  })
})
