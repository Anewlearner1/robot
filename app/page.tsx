import { getAllDiseases } from '@/lib/getDiseases'
import DiseaseCard from '@/components/DiseaseCard'

export default function Home() {
  const diseases = getAllDiseases()

  return (
    <div className="max-w-5xl mx-auto px-4 py-10">
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-gray-800">骨骼肌肉復健運動</h1>
        <p className="mt-2 text-gray-500">選擇你的疾病，找到適合的復健動作</p>
      </header>

      {/* 手機單欄 → 平板雙欄 → 桌機三欄 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {diseases.map((disease) => (
          <DiseaseCard key={disease.id} disease={disease} />
        ))}
      </div>
    </div>
  )
}
