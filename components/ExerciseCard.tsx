import Image from 'next/image'
import type { Exercise } from '@/lib/types'

interface Props {
  exercise: Exercise
}

export default function ExerciseCard({ exercise }: Props) {
  return (
    <div className="rounded-xl shadow-sm bg-white p-4 space-y-4">
      <h3 className="text-lg font-semibold text-gray-800">{exercise.name}</h3>

      <div className="relative w-full aspect-video rounded-lg overflow-hidden bg-gray-100">
        <Image
          src={exercise.gif}
          alt={`${exercise.name} 示範動作`}
          fill
          className="object-contain"
          unoptimized
        />
      </div>

      <ol className="list-decimal list-inside space-y-1 text-sm text-gray-700">
        {exercise.steps.map((step, i) => (
          <li key={i}>{step}</li>
        ))}
      </ol>

      {exercise.cautions.length > 0 && (
        <div className="rounded-lg bg-orange-50 border border-orange-200 p-3">
          <p className="text-xs font-semibold text-orange-700 mb-1">注意事項</p>
          <ul className="list-disc list-inside space-y-1">
            {exercise.cautions.map((c, i) => (
              <li key={i} className="text-xs text-orange-700">{c}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex gap-4 text-sm text-gray-600">
        <span>{exercise.sets}</span>
        <span>{exercise.reps}</span>
        <span>{exercise.equipment}</span>
      </div>
    </div>
  )
}
