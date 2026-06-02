import { notFound } from 'next/navigation'
import { getDiseaseById, getAllDiseases } from '@/lib/getDiseases'
import PhasesTabs from '@/components/PhasesTabs'

interface Props {
  params: Promise<{ id: string }>
}

export async function generateStaticParams() {
  return getAllDiseases().map((d) => ({ id: d.id }))
}

export default async function DiseasePage({ params }: Props) {
  const { id } = await params
  const disease = getDiseaseById(id)

  if (!disease) notFound()

  return (
    <div className="max-w-4xl mx-auto px-4 py-10">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800">{disease.name}</h1>
        <p className="mt-2 text-gray-500">{disease.description}</p>
      </div>

      <PhasesTabs phases={disease.phases} />
    </div>
  )
}
