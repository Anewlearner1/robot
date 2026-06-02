import Fuse from 'fuse.js'
import diseases from '@/data/diseases.json'
import type { Disease } from './types'

export interface SearchResult {
  id: string
  name: string
  type: 'disease' | 'exercise'
  diseaseId: string
  diseaseName: string
}

function buildIndex(): SearchResult[] {
  const items: SearchResult[] = []
  for (const disease of diseases as Disease[]) {
    items.push({
      id: disease.id,
      name: disease.name,
      type: 'disease',
      diseaseId: disease.id,
      diseaseName: disease.name,
    })
    // Include aliases as separate searchable entries pointing to the same disease
    for (const alias of disease.aliases) {
      items.push({
        id: `${disease.id}-alias-${alias}`,
        name: alias,
        type: 'disease',
        diseaseId: disease.id,
        diseaseName: disease.name,
      })
    }
    // Include exercise names
    const allExercises = [
      ...disease.phases.acute,
      ...disease.phases.recovery,
      ...disease.phases.strengthening,
    ]
    for (const ex of allExercises) {
      items.push({
        id: ex.id,
        name: ex.name,
        type: 'exercise',
        diseaseId: disease.id,
        diseaseName: disease.name,
      })
    }
  }
  return items
}

const searchItems = buildIndex()

export const fuse = new Fuse(searchItems, {
  keys: ['name'],
  threshold: 0.4,
  includeScore: true,
})

export function search(query: string): SearchResult[] {
  if (!query.trim()) return []
  const results = fuse.search(query, { limit: 8 })
  // Deduplicate by diseaseId when type is disease
  const seen = new Set<string>()
  return results
    .map((r) => r.item)
    .filter((item) => {
      const key = item.type === 'disease' ? `d:${item.diseaseId}` : `e:${item.id}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}
