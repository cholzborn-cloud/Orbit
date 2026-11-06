import assert from "node:assert/strict"
import test from "node:test"

import { groupRoundPrompt, isSilent, parseMentions, planRound } from "./group-round.ts"

const members = [
  { id: "a1", name: "Alpha" },
  { id: "b2", name: "Beta" },
  { id: "g3", name: "Gamma Ray" },
  { id: "g4", name: "Gamma" },
]

test("Erwähnungen: Verweis per Id, Klartext eindeutig, längster Name zuerst, Reihenfolge des Auftretens", () => {
  assert.deepEqual(parseMentions("Hi @Beta und @alpha!", members), ["b2", "a1"])
  assert.deepEqual(parseMentions("@[Falscher Name](orbi:b2) bitte", members), ["b2"])
  // „Gamma Ray“ ist länger als „Gamma“: eindeutig, nicht beide
  assert.deepEqual(parseMentions("@Gamma Ray hilf", members), ["g3"])
  assert.deepEqual(parseMentions("@Gamma hilf", members), ["g4"])
  // Wortgrenze: @Betamax ist nicht @Beta; unbekannte Ids und Namen zählen nicht
  assert.deepEqual(parseMentions("@Betamax @[X](orbi:zzz) @Nobody", members), [])
  // doppelt genannt zählt einmal; Verweis und Klartext mischen
  assert.deepEqual(parseMentions("@Beta @[Beta](orbi:b2) @Alpha", members), ["b2", "a1"])
  // mehrdeutiger Klartextname (zwei gleiche) wird ignoriert, der Verweis geht
  const twins = [{ id: "x1", name: "Max" }, { id: "x2", name: "max" }]
  assert.deepEqual(parseMentions("@Max", twins), [])
  assert.deepEqual(parseMentions("@[Max](orbi:x2)", twins), ["x2"])
})

test("Plan: Markierte zuerst, dann Mitgliederreihenfolge; Rückfall = gewählter, sonst erster; Absender fällt weg", () => {
  const plan = planRound({ members, text: "@Beta und @Gamma", selected: "a1" })!
  assert.deepEqual(plan.order, ["b2", "g4", "a1", "g3"])
  assert.deepEqual(plan.marked, ["b2", "g4"])
  assert.equal(plan.fallback, "a1")
  assert.equal(planRound({ members, text: "Hallo", selected: "unbekannt" })!.fallback, "a1")
  const byOrbi = planRound({ members, text: "@Alpha?", exclude: "a1" })!
  assert.deepEqual(byOrbi.order, ["b2", "g3", "g4"])
  assert.deepEqual(byOrbi.marked, [])
  assert.equal(planRound({ members: [], text: "x" }), null)
})

test("Schweigen: leerer Text oder nur Denken; Text, Werkzeug oder Datei zählen", () => {
  const msg = (...parts: unknown[]) => ({ parts }) as never
  assert.equal(isSilent(undefined), true)
  assert.equal(isSilent(msg()), true)
  assert.equal(isSilent(msg({ type: "step-start" }, { type: "text", text: "  \n" })), true)
  assert.equal(isSilent(msg({ type: "reasoning", text: "denke" })), true)
  assert.equal(isSilent(msg({ type: "text", text: "Ja" })), false)
  assert.equal(isSilent(msg({ type: "tool-web_search", state: "output-available" })), false)
})

test("Prompt-Zusatz: kurz (unter 400 Zeichen), Hinweis nur für Markierte und Nachlauf", () => {
  const plain = groupRoundPrompt("Beta", { marked: false })
  assert.ok(groupRoundPrompt("Beta", { marked: true }).length < 400)
  assert.doesNotMatch(plain, /MUST|must/)
  assert.match(groupRoundPrompt("Beta", { marked: true }), /tagged: you MUST answer/)
  assert.doesNotMatch(groupRoundPrompt("Beta", { marked: true }), /write nothing/)
  assert.doesNotMatch(groupRoundPrompt("Beta", { marked: true, forced: true }), /write nothing/)
  assert.match(groupRoundPrompt("Beta", { marked: false, forced: true }), /must answer now/)
})
