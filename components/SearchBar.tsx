'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { search, type SearchResult } from '@/lib/searchIndex'

export default function SearchBar() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [open, setOpen] = useState(false)
  const [notFound, setNotFound] = useState(false)
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)

  const handleChange = useCallback((value: string) => {
    setQuery(value)
    if (!value.trim()) {
      setResults([])
      setOpen(false)
      setNotFound(false)
      return
    }
    const found = search(value)
    setResults(found)
    setNotFound(found.length === 0)
    setOpen(true)
  }, [])

  const handleSelect = (result: SearchResult) => {
    router.push(`/diseases/${result.diseaseId}`)
    setQuery('')
    setOpen(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setOpen(false)
      setQuery('')
    }
  }

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (inputRef.current && !inputRef.current.closest('[data-search-container]')?.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div data-search-container className="relative w-full max-w-sm">
      <input
        ref={inputRef}
        role="searchbox"
        type="search"
        placeholder="搜尋疾病或動作…"
        value={query}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={handleKeyDown}
        className="w-full rounded-full border border-gray-200 bg-white px-4 py-2 text-sm focus:outline-none focus:border-[#E8845A] focus:ring-1 focus:ring-[#E8845A]"
        aria-autocomplete="list"
        aria-expanded={open}
      />

      {open && (
        <ul
          role="listbox"
          className="absolute left-0 right-0 top-full mt-1 rounded-xl border border-gray-100 bg-white shadow-lg z-50 max-h-64 overflow-y-auto"
        >
          {notFound ? (
            <li className="px-4 py-3 text-sm text-gray-400">找不到相關內容</li>
          ) : (
            results.map((result) => (
              <li
                key={result.id}
                role="option"
                aria-selected={false}
                onClick={() => handleSelect(result)}
                className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-orange-50 cursor-pointer"
              >
                <span className="text-xs rounded-full px-2 py-0.5 bg-gray-100 text-gray-500">
                  {result.type === 'disease' ? '疾病' : '動作'}
                </span>
                <span className="text-gray-700">
                  {result.name !== result.diseaseName && result.type === 'disease'
                    ? `${result.diseaseName}（${result.name}）`
                    : result.name}
                </span>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}
