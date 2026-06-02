export interface Exercise {
  id: string
  name: string
  gif: string
  steps: string[]
  cautions: string[]
  sets: string
  reps: string
  equipment: string
}

export interface Disease {
  id: string
  name: string
  aliases: string[]
  description: string
  phases: {
    acute: Exercise[]
    recovery: Exercise[]
    strengthening: Exercise[]
  }
}
