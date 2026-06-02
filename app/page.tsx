import Link from 'next/link'
import { getAllDiseases } from '@/lib/getDiseases'

export default function Home() {
  const diseases = getAllDiseases()

  return (
    <div className="max-w-4xl mx-auto px-4 py-10">
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-gray-800">骨骼肌肉復健運動</h1>
        <p className="mt-2 text-gray-500">選擇你的疾病，找到適合的復健動作</p>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {diseases.map((disease) => (
          <Link
            key={disease.id}
            href={`/diseases/${disease.id}`}
            className="block rounded-xl shadow-sm bg-white p-5 hover:shadow-md transition-shadow border border-gray-100"
          >
            <h2 className="text-lg font-semibold text-gray-800">{disease.name}</h2>
            <p className="mt-1 text-sm text-gray-500 line-clamp-2">{disease.description}</p>
          </Link>
        ))}
      </div>
    </div>
  )
}
