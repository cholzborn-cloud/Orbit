export type JudgeScore = "bestanden" | "nicht bestanden" | "nicht bewertet"

export type EvalSample = {
  id: string
  input: string
  output: string
  context?: Record<string, unknown>
}

export type JudgeRubric = {
  name: string
  version: string
  description: string
  rasterPrompt: string // System-Prompt des Judges; leer = Standard-Raster aus judge.ts
}

export type EvalResult = {
  sampleId: string
  rubric: string
  version: string
  score: JudgeScore
  reason: string
  error?: string
}

export type EvalSuiteReport = {
  total: number
  bestanden: number
  nichtBestanden: number
  nichtBewertet: number
  results: EvalResult[]
}
