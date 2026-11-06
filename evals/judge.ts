import type { EvalResult, EvalSample, JudgeRubric } from "./types.ts"

export type JudgeCall = (input: { system: string; prompt: string }) => Promise<string>

// Phase G: Qualitätssicherung – Judge bewertet Samples nach versioniertem Raster.
// Harte Regel: Jeder Judge-Fehler (Fehlwurf, Timeout, JSON-Fehler) = "nicht bewertet"!
export async function judgeSample(
  sample: EvalSample,
  rubric: JudgeRubric,
  judgeCall?: JudgeCall
): Promise<EvalResult> {
  const baseResult: Omit<EvalResult, "score" | "reason" | "error"> = {
    sampleId: sample.id,
    rubric: rubric.name,
    version: rubric.version,
  }

  if (!judgeCall) {
    return {
      ...baseResult,
      score: "nicht bewertet",
      reason: "Kein Judge-Aufruf konfiguriert.",
      error: "No judge runner provided",
    }
  }

  try {
    const system =
      rubric.rasterPrompt ||
      `Du bist ein strenger Eval-Judge. Bewerte die Modellausgabe anhand des Rasters ${rubric.name} (${rubric.version}).
Antworte AUSSCHLIESSLICH als JSON-Objekt im Format:
{"score": "bestanden" | "nicht bestanden", "reason": "Kurze Begründung"}`

    const prompt = JSON.stringify({
      sampleInput: sample.input,
      sampleOutput: sample.output,
      context: sample.context ?? {},
    })

    const rawResponse = await judgeCall({ system, prompt })
    const start = rawResponse.indexOf("{")
    const end = rawResponse.lastIndexOf("}")
    if (start < 0 || end <= start) {
      return {
        ...baseResult,
        score: "nicht bewertet",
        reason: "Judge lieferte kein gültiges JSON-Format.",
        error: "Invalid JSON response from judge",
      }
    }

    const parsed = JSON.parse(rawResponse.slice(start, end + 1)) as {
      score?: string
      reason?: string
    }

    if (parsed.score === "bestanden" || parsed.score === "nicht bestanden") {
      return {
        ...baseResult,
        score: parsed.score,
        reason: parsed.reason || "Keine Begründung angegeben.",
      }
    }

    return {
      ...baseResult,
      score: "nicht bewertet",
      reason: `Unerwarteter Score-Wert: ${parsed.score}`,
      error: "Unexpected score value",
    }
  } catch (err) {
    // Phase G Regel: Jeder Judge-Fehler zählt strikt als "nicht bewertet", nie als bestanden/nicht bestanden!
    const errMsg = err instanceof Error ? err.message : String(err)
    return {
      ...baseResult,
      score: "nicht bewertet",
      reason: `Judge-Aufruf fehlgeschlagen: ${errMsg}`,
      error: errMsg,
    }
  }
}
