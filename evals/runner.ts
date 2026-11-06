import { judgeSample, type JudgeCall } from "./judge.ts"
import type { EvalResult, EvalSample, EvalSuiteReport, JudgeRubric } from "./types.ts"

export async function runEvalSuite(
  samples: EvalSample[],
  rubrics: JudgeRubric[],
  judgeCall?: JudgeCall
): Promise<EvalSuiteReport> {
  const results: EvalResult[] = []

  for (const sample of samples) {
    for (const rubric of rubrics) {
      const res = await judgeSample(sample, rubric, judgeCall)
      results.push(res)
    }
  }

  const bestanden = results.filter((r) => r.score === "bestanden").length
  const nichtBestanden = results.filter((r) => r.score === "nicht bestanden").length
  const nichtBewertet = results.filter((r) => r.score === "nicht bewertet").length

  return {
    total: results.length,
    bestanden,
    nichtBestanden,
    nichtBewertet,
    results,
  }
}
