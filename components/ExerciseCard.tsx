'use client'

import Image from 'next/image'
import dynamic from 'next/dynamic'
import type { Exercise } from '@/lib/types'

const Lottie = dynamic(() => import('lottie-react'), { ssr: false })

interface Props {
  exercise: Exercise
}

function ExerciseAnimation({ exercise }: { exercise: Exercise }) {
  if (exercise.lottie) {
    return (
      <LottiePlayer src={exercise.lottie} name={exercise.name} />
    )
  }
  return (
    <Image
      src={exercise.gif}
      alt={`${exercise.name} 示範動作`}
      fill
      className="object-contain"
      unoptimized
    />
  )
}

function LottiePlayer({ src, name }: { src: string; name: string }) {
  // dynamically import the JSON so Next.js bundles it correctly
  const [data, setData] = React.useState<object | null>(null)

  React.useEffect(() => {
    fetch(src)
      .then(r => r.json())
      .then(setData)
      .catch(() => setData(null))
  }, [src])

  if (!data) return null
  return <Lottie animationData={data} loop className="w-full h-full object-contain" aria-label={`${name} 示範動作`} />
}

// import React for hooks used in LottiePlayer
import React from 'react'

export default function ExerciseCard({ exercise }: Props) {
  return (
    <div className="rounded-xl shadow-sm bg-white p-4 space-y-4">
      <h3 className="text-lg font-semibold text-gray-800">{exercise.name}</h3>

      {/* 動畫區域 — 優先 Lottie，退回 GIF */}
      <div className="relative w-full aspect-video rounded-lg overflow-hidden bg-gray-100">
        <ExerciseAnimation exercise={exercise} />
      </div>

      {/* 步驟說明 */}
      <ol className="list-decimal list-inside space-y-1 text-sm text-gray-700">
        {exercise.steps.map((step, i) => (
          <li key={i}>{step}</li>
        ))}
      </ol>

      {/* 注意事項 */}
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
