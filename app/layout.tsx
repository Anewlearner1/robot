import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: '骨骼肌肉復健運動',
  description: '針對各種骨骼肌肉疾病提供分階段復健動作，免費、繁體中文、無需帳號。',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-TW">
      <body className="font-sans bg-[#FAF8F5] min-h-screen flex flex-col">
        <main className="flex-1">{children}</main>
        <footer className="bg-white border-t border-gray-200 py-4 px-6 mt-8">
          <p className="text-xs text-gray-500 text-center leading-relaxed">
            本網站內容僅供衛教參考，不取代專業醫療診斷與建議。如有不適，請諮詢醫師或物理治療師。
          </p>
        </footer>
      </body>
    </html>
  )
}
