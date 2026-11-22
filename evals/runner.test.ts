import assert from "node:assert/strict"
import test from "node:test"

import { judgeSample } from "./judge.ts"
import { runEvalSuite } from "./runner.ts"
import { replyHabitsRubricV1 } from "./rubrics/reply-habits-v1.ts"
import { delegationRubricV1 } from "./rubrics/delegation-v1.ts"
import { silenceRubricV1 } from "./rubrics/silence-v1.ts"
import type { EvalSample } from "./types.ts"

test("Eval-Judge: bewertet bestanden und nicht bestanden korrekt", async () => {
  const sample: EvalSample = {
    id: "s1",
    input: "Wie ist das Wetter?",
    output: "18 Grad, sonnig.",
  }

  const passJudge = async () => JSON.stringify({ score: "bestanden", reason: "Antwort zuerst und präzise." })
  const passRes = await judgeSample(sample, replyHabitsRubricV1, passJudge)
  assert.equal(passRes.score, "bestanden")
  assert.equal(passRes.sampleId, "s1")

  const failJudge = async () => JSON.stringify({ score: "nicht bestanden", reason: "Zu viel Fülltext." })
  const failRes = await judgeSample(sample, replyHabitsRubricV1, failJudge)
  assert.equal(failRes.score, "nicht bestanden")
})

test("Eval-Judge: Judge-Fehler führen zwingend zu „nicht bewertet“", async () => {
  const sample: EvalSample = {
    id: "s2",
    input: "Hintergrund-Aufgabe",
    output: "Ich mache das jetzt inline in 10 Runden...",
  }

  // 1. Exception / Netzwerkfehler
  const throwingJudge = async () => {
    throw new Error("API Timeout / 500")
  }
  const errorRes = await judgeSample(sample, delegationRubricV1, throwingJudge)
  assert.equal(errorRes.score, "nicht bewertet")
  assert.match(errorRes.reason, /API Timeout/)

  // 2. Unlesbares Format
  const badJsonJudge = async () => "Das ist kein JSON"
  const badJsonRes = await judgeSample(sample, delegationRubricV1, badJsonJudge)
  assert.equal(badJsonRes.score, "nicht bewertet")
  assert.match(badJsonRes.reason, /kein gültiges JSON/)

  // 3. Unerwarteter Score-Wert
  const weirdScoreJudge = async () => JSON.stringify({ score: "maybe", reason: "unsicher" })
  const weirdRes = await judgeSample(sample, silenceRubricV1, weirdScoreJudge)
  assert.equal(weirdRes.score, "nicht bewertet")
})

test("Eval-Runner: aggregiert Suite-Ergebnisse", async () => {
  const samples: EvalSample[] = [
    { id: "s1", input: "Frage 1", output: "Antwort 1" },
    { id: "s2", input: "Frage 2", output: "Antwort 2" },
  ]
  const rubrics = [replyHabitsRubricV1, silenceRubricV1]

  let callCount = 0
  const mockJudge = async () => {
    callCount++
    if (callCount === 1) return JSON.stringify({ score: "bestanden", reason: "ok" })
    if (callCount === 2) return JSON.stringify({ score: "nicht bestanden", reason: "lang" })
    if (callCount === 3) throw new Error("Server error")
    return JSON.stringify({ score: "bestanden", reason: "ok" })
  }

  const report = await runEvalSuite(samples, rubrics, mockJudge)
  assert.equal(report.total, 4)
  assert.equal(report.bestanden, 2)
  assert.equal(report.nichtBestanden, 1)
  assert.equal(report.nichtBewertet, 1)
})
