import diseases from '@/data/diseases.json'
import fs from 'fs'
import path from 'path'
import type { Disease } from '@/lib/types'

describe('Issue #6/#7 — 疾病內容完整性', () => {
  it('至少有 10 種疾病', () => {
    expect(diseases.length).toBeGreaterThanOrEqual(10)
  })

  it('每種疾病三個階段都定義（可為空陣列）', () => {
    for (const d of diseases as Disease[]) {
      expect(d.phases.acute).toBeDefined()
      expect(d.phases.recovery).toBeDefined()
      expect(d.phases.strengthening).toBeDefined()
    }
  })

  it('每個動作的注意事項至少 1 條', () => {
    for (const d of diseases as Disease[]) {
      const all = [...d.phases.acute, ...d.phases.recovery, ...d.phases.strengthening]
      for (const ex of all) {
        expect(ex.cautions.length).toBeGreaterThanOrEqual(1)
      }
    }
  })

  it('每個動作對應的 GIF placeholder 存在於 /public/gifs/', () => {
    const gifsDir = path.join(process.cwd(), 'public', 'gifs')
    for (const d of diseases as Disease[]) {
      const all = [...d.phases.acute, ...d.phases.recovery, ...d.phases.strengthening]
      for (const ex of all) {
        const gifPath = path.join(process.cwd(), 'public', ex.gif)
        expect(fs.existsSync(gifPath)).toBe(true)
      }
    }
  })

  it('疾病資料使用繁體中文（步驟說明非空）', () => {
    for (const d of diseases as Disease[]) {
      const all = [...d.phases.acute, ...d.phases.recovery, ...d.phases.strengthening]
      for (const ex of all) {
        expect(ex.steps.length).toBeGreaterThanOrEqual(1)
        expect(ex.steps[0]).not.toBe('')
      }
    }
  })
})
