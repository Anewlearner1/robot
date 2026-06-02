import diseases from '@/data/diseases.json'
import type { Disease } from './types'

export function getAllDiseases(): Disease[] {
  return diseases as Disease[]
}

export function getDiseaseById(id: string): Disease | undefined {
  return (diseases as Disease[]).find((d) => d.id === id)
}
