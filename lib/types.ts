export interface Exercise {
  id: string
  name: string
  gif: string
  lottie?: string   // Lottie JSON 路徑，優先於 gif
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
