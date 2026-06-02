import Image from 'next/image'
import type { Exercise } from '@/lib/types'

interface Props {
  exercise: Exercise
}

export default function ExerciseCard({ exercise }: Props) {
  return (
    <div className="rounded-xl shadow-sm bg-white p-4 space-y-4">
      <h3 className="text-lg font-semibold text-gray-800">{exercise.name}</h3>

      {/* GIF — unoptimized 保留 GIF 動畫迴圈 */}
      <div className="relative w-full aspect-video rounded-lg overflow-hidden bg-gray-100">
        <Image
          src={exercise.gif}
          alt={`${exercise.name} 示範動作`}
          fill
          className="object-contain"
          unoptimized
        />
      </div>

      {/* 步驟說明 */}
      <ol className="list-decimal list-inside space-y-1 text-sm text-gray-700">
        {exercise.steps.map((step, i) => (
          <li key={i}>{step}</li>
        ))}
      </ol>

      {/* 注意事項 — 橘色左框線；空陣列時不渲染 */}
      {exercise.cautions.length > 0 && (
        <div
          data-testid="cautions-block"
          className="border-l-4 border-[#E8845A] bg-orange-50 pl-3 py-2 space-y-1"
        >
          <p className="text-xs font-semibold text-[#E8845A]">注意事項</p>
          {exercise.cautions.map((c, i) => (
            <p key={i} className="text-xs text-orange-700">{c}</p>
          ))}
        </div>
      )}

      {/* 組數 / 次數 / 器材 badges */}
      <div className="flex flex-wrap gap-2">
        <span
          data-testid="sets-badge"
          className="inline-flex items-center rounded-full bg-green-50 border border-green-200 px-3 py-1 text-xs font-medium text-[#5A9E7C]"
        >
          {exercise.sets}
        </span>
        <span
          data-testid="reps-badge"
          className="inline-flex items-center rounded-full bg-green-50 border border-green-200 px-3 py-1 text-xs font-medium text-[#5A9E7C]"
        >
          {exercise.reps}
        </span>
        <span
          data-testid="equipment-badge"
          className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium ${
            exercise.equipment === '徒手'
              ? 'equipment-bare-hands bg-gray-50 border-gray-200 text-gray-600'
              : 'bg-blue-50 border-blue-200 text-blue-700'
          }`}
        >
          {exercise.equipment === '徒手' && <span aria-hidden="true">✋</span>}
          {exercise.equipment}
        </span>
      </div>
    </div>
  )
}
