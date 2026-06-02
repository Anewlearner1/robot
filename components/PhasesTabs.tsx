'use client'

import { useState } from 'react'
import ExerciseCard from './ExerciseCard'
import type { Disease } from '@/lib/types'

const PHASE_LABELS: Record<string, string> = {
  acute: '急性期',
  recovery: '恢復期',
  strengthening: '強化期',
}

interface Props {
  phases: Disease['phases']
}

export default function PhasesTabs({ phases }: Props) {
  const [active, setActive] = useState<'acute' | 'recovery' | 'strengthening'>('acute')

  return (
    <div>
      <div className="flex gap-2 mb-6">
        {(['acute', 'recovery', 'strengthening'] as const).map((phase) => (
          <button
            key={phase}
            onClick={() => setActive(phase)}
            className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
              active === phase
                ? 'bg-[#E8845A] text-white'
                : 'bg-white text-gray-600 border border-gray-200 hover:border-[#E8845A]'
            }`}
          >
            {PHASE_LABELS[phase]}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {phases[active].length === 0 ? (
          <p className="text-gray-400 text-sm col-span-2">此階段尚無動作資料</p>
        ) : (
          phases[active].map((exercise) => (
            <ExerciseCard key={exercise.id} exercise={exercise} />
          ))
        )}
      </div>
    </div>
  )
}
