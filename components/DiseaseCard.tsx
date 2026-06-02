import Link from 'next/link'
import type { Disease } from '@/lib/types'

interface Props {
  disease: Pick<Disease, 'id' | 'name' | 'description'>
}

export default function DiseaseCard({ disease }: Props) {
  return (
    <Link
      href={`/diseases/${disease.id}`}
      className="block rounded-xl shadow-sm bg-white p-5 hover:shadow-md hover:border-[#E8845A] transition-all border border-gray-100 group"
    >
      <h2 className="text-base font-semibold text-gray-800 group-hover:text-[#E8845A] transition-colors">
        {disease.name}
      </h2>
      <p className="mt-1 text-sm text-gray-500 line-clamp-2">{disease.description}</p>
    </Link>
  )
}
