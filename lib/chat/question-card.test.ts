import assert from "node:assert/strict"
import test from "node:test"

import type { LanguageModelV4StreamPart } from "@ai-sdk/provider"

import { createQuestionCardGate, detectUserQuestion, normalizeAskInput, optionsFrom, withoutSmalltalkTail } from "./question-card.ts"

test("Frage am Ende an Consti wird erkannt (Ja/Nein als Rückfall)", () => {
  const found = detectUserQuestion("Ich habe die Datei angelegt.\n\nSoll ich sie auch gleich an Jev schicken?")
  assert.equal(found?.question, "Soll ich sie auch gleich an Jev schicken?")
  assert.deepEqual(found?.options, [{ label: "Ja", recommended: true }, { label: "Nein" }])
})

test("englische Frage", () => {
  assert.ok(detectUserQuestion("Done with the draft. Do you want me to send it now?"))
})

test("Optionen aus einer Liste, Empfehlung nach vorn", () => {
  const found = detectUserQuestion("Welche Variante nehmen wir?\n\n- Kurz\n- Lang (Empfehlung)\n- Gar nicht")
  assert.equal(found?.question, "Welche Variante nehmen wir?")
  assert.deepEqual(found?.options, [{ label: "Lang", recommended: true }, { label: "Kurz" }, { label: "Gar nicht" }])
})

test("„A oder B?“ wird zu zwei Optionen", () => {
  const options = optionsFrom("Lieber morgen oder Freitag?", "Lieber morgen oder Freitag?")
  assert.deepEqual(options, [{ label: "morgen", recommended: true }, { label: "Freitag" }])
})

test("keine Fehlalarme: Code, Zitat, Anführungszeichen, Rhetorik mitten im Text, Aussage", () => {
  assert.equal(detectUserQuestion("Hier der Code:\n```js\nconst ok = a ? b : c // was jetzt?\n```"), null)
  assert.equal(detectUserQuestion("> Kannst du das prüfen?\n\nErledigt, alles geprüft."), null)
  assert.equal(detectUserQuestion("Er fragte „Kommst du morgen?“ und ging."), null)
  assert.equal(detectUserQuestion("Warum dauert das so lange? Weil der Server langsam ist. Ich habe ihn neu gestartet."), null)
  assert.equal(detectUserQuestion("Alles erledigt, die Notiz liegt im Brain."), null)
})

test("echte ask_user-Eingaben: genau eine Empfehlung, vorn", () => {
  const out = normalizeAskInput({ questions: [{ question: "X?", options: [{ label: "A" }, { label: "B", recommended: true }, { label: "C", recommended: true }] }] }) as {
    questions: { options: { label: string; recommended?: boolean }[] }[]
  }
  assert.deepEqual(out.questions[0].options, [{ label: "B", recommended: true }, { label: "A" }, { label: "C" }])
})

async function run(parts: LanguageModelV4StreamPart[], enabled = true, tools = [{ type: "function", name: "ask_user" }]) {
  const gate = createQuestionCardGate({ enabled })
  const result = await gate.wrapStream!({
    doStream: async () => ({ stream: new ReadableStream({ start(c) { for (const p of parts) c.enqueue(p); c.close() } }) }),
    doGenerate: async () => { throw new Error("nicht genutzt") },
    params: { prompt: [], tools } as never,
    model: {} as never,
  } as never)
  const out: LanguageModelV4StreamPart[] = []
  const reader = result.stream.getReader()
  for (;;) { const { done, value } = await reader.read(); if (done) break; out.push(value) }
  return out
}

const finish = (unified: "stop" | "tool-calls"): LanguageModelV4StreamPart => ({ type: "finish", finishReason: { unified, raw: undefined }, usage: {} as never })
const textParts = (t: string): LanguageModelV4StreamPart[] => [{ type: "text-start", id: "0" }, { type: "text-delta", id: "0", delta: t }, { type: "text-end", id: "0" }]

test("Middleware: Frage im Text ohne Karte → ask_user-Aufruf, Schritt endet mit tool-calls", async () => {
  const out = await run([...textParts("Fertig. Soll ich es auch an Jev schicken?"), finish("stop")])
  const call = out.find((p) => p.type === "tool-call")
  assert.ok(call && call.type === "tool-call" && call.toolName === "ask_user")
  assert.equal(JSON.parse(call.input).questions[0].question, "Soll ich es auch an Jev schicken?")
  const end = out.at(-1)
  assert.ok(end?.type === "finish" && end.finishReason.unified === "tool-calls")
})

test("Middleware: aus, ohne ask_user-Werkzeug oder ohne Frage → unverändert", async () => {
  for (const [parts, enabled, tools] of [
    [[...textParts("Soll ich?"), finish("stop")], false, undefined],
    [[...textParts("Soll ich?"), finish("stop")], true, []],
    [[...textParts("Erledigt."), finish("stop")], true, undefined],
  ] as const) {
    const out = await run([...parts], enabled, tools as never)
    assert.equal(out.some((p) => p.type === "tool-call"), false)
  }
})

test("Middleware: höchstens zwei erzwungene Karten je Turn", async () => {
  const gate = createQuestionCardGate({ enabled: true })
  let forced = 0
  for (let i = 0; i < 3; i++) {
    const result = await gate.wrapStream!({
      doStream: async () => ({ stream: new ReadableStream({ start(c) { for (const p of [...textParts("Soll ich weitermachen?"), finish("stop")]) c.enqueue(p); c.close() } }) }),
      params: { prompt: [], tools: [{ type: "function", name: "ask_user" }] } as never,
    } as never)
    const reader = result.stream.getReader()
    for (;;) { const { done, value } = await reader.read(); if (done) break; if (value.type === "tool-call") forced++ }
  }
  assert.equal(forced, 2)
})

test("Zusatzangebot nach fertiger Antwort ist keine Fragekarte, eine echte Entscheidung schon", () => {
  const answer = "Ich habe in deinem Dokumente-Ordner zwei SMV-Ordner gefunden: Schule/Aktuell/SMV und Schule/Archiv/SMV. Im aktuellen liegen keine Dateien, im Archiv drei PDFs mit Protokollen aus dem letzten Jahr."
  assert.equal(detectUserQuestion(`${answer}\n\nSoll ich die PDFs öffnen?`), null)
  assert.equal(detectUserQuestion(`${answer}\n\nBrauchst du noch etwas dazu?`), null)
  // Kurze Antwort mit echter Entscheidung davor bleibt eine Karte
  assert.ok(detectUserQuestion("Soll ich die Datei löschen?"))
})

test("Keine Karte bei Smalltalk-Gegenfragen, offenen W-Fragen ohne Auswahl und Zusatzangeboten; echte Ja/Nein-Entscheidung bleibt Karte (09.11.2026)", () => {
  for (const text of [
    "Mir geht es gut, danke! Und dir?",
    "Alles bestens hier. Wie geht es dir?",
    "Läuft super. Wie war dein Tag?",
    "Was soll ich heute für dich erledigen?",
    "Soll ich noch etwas nachschauen?",
  ])
    assert.equal(detectUserQuestion(text), null, text)
  assert.equal(detectUserQuestion("Womit kann ich dir noch helfen?"), null)
  // Echte offene Rückfrage bleibt Karte (mit Freitextfeld).
  assert.ok(detectUserQuestion("Welchen Ordner meinst du?"))
  assert.deepEqual(detectUserQuestion("Soll ich die Mail jetzt senden?")?.options.map((o) => o.label), ["Ja", "Nein"])
  assert.deepEqual(detectUserQuestion("Welche Datei meinst du?\n- a.txt\n- b.txt")?.options.map((o) => o.label), ["a.txt", "b.txt"])
})

test("Smalltalk-Gegenfrage am Ende fällt weg, Angebote und echte Rückfragen bleiben (09.11.2026)", () => {
  assert.equal(withoutSmalltalkTail("Mir geht es gut, danke! Und dir?"), "Mir geht es gut, danke!")
  assert.equal(withoutSmalltalkTail("Gut, danke! Wie geht es dir?"), "Gut, danke!")
  assert.equal(withoutSmalltalkTail("Gut! Was soll ich heute für dich erledigen?"), "Gut! Was soll ich heute für dich erledigen?")
  assert.equal(withoutSmalltalkTail("Alles klar. Welche Datei meinst du?"), "Alles klar. Welche Datei meinst du?")
})
