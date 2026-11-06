import assert from "node:assert/strict"
import { test } from "node:test"
import type { ModelMessage } from "ai"

import { condenseOldToolResults, shortenCutoff } from "./old-results.ts"
import { endsAfterReact, REACT } from "./reactions.ts"

const user = (text: string): ModelMessage => ({ role: "user", content: [{ type: "text", text }] })
const result = (id: string, value: string): ModelMessage => ({
  role: "tool",
  content: [{ type: "tool-result", toolCallId: id, toolName: "web_search", output: { type: "text", value } }],
})

test("Tool-Ergebnisse älter als zwei Turns werden zu einer Zeile (in Blöcken), neuere bleiben", () => {
  const long = "x".repeat(5000)
  const messages = [user("1"), result("a", long), user("2"), result("b", long), user("3"), result("c", long), user("4"), result("d", long), user("5"), result("e", long), user("6")]
  const out = condenseOldToolResults(messages)
  const values = out.flatMap((m) => (m.role === "tool" ? [(m.content[0] as { output: { value: string } }).output.value] : []))
  assert.match(values[0]!, /^\[web_search: older result shortened, 5000 characters; id a\]$/)
  assert.match(values[1]!, /^\[web_search: older result shortened/)
  assert.match(values[2]!, /^\[web_search: older result shortened/)
  assert.equal(values[3], long)
  assert.equal(values[4], long)
  // Eingabe bleibt unverändert (der gespeicherte Verlauf ist nie betroffen).
  assert.equal((messages[1] as { content: { output: { value: string } }[] }).content[0]!.output.value, long)
  assert.equal(out.length, messages.length)
})

test("Die Kürz-Grenze rückt nur alle drei Turns vor, mindestens zwei Turns bleiben voll (Cache-Präfix)", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => shortenCutoff(n)), [0, 0, 0, 0, 0, 3, 3, 3, 6, 6])
  for (let users = 3; users <= 30; users++) assert.ok(users - shortenCutoff(users) > 2 && users - shortenCutoff(users) <= 5)
})

test("Kurze alte Tool-Ergebnisse bleiben erhalten, wenn der Platzhalter länger wäre", () => {
  const messages = [user("1"), result("a", "ok"), user("2"), user("3"), user("4"), user("5"), user("6")]
  const out = condenseOldToolResults(messages)
  assert.equal((out[1] as { content: { output: { value: string } }[] }).content[0]!.output.value, "ok")
})

test("Alte strukturierte Medienergebnisse werden weiterhin gekürzt", () => {
  const media = { role: "tool", content: [{ type: "tool-result", toolCallId: "a", toolName: "bild", output: { type: "content", value: [{ type: "image-data", data: "x".repeat(500), mediaType: "image/png" }] } }] } as unknown as ModelMessage
  const out = condenseOldToolResults([user("1"), media, user("2"), user("3"), user("4"), user("5"), user("6")])
  assert.match((out[1] as { content: { output: { value: string } }[] }).content[0]!.output.value, /older result shortened/)
})

test("react-Schritt allein beendet den Turn, nur bei Erfolg", () => {
  const step = (calls: string[], outputs: unknown[]) => ({
    toolCalls: calls.map((toolName) => ({ toolName })),
    toolResults: calls.map((toolName, i) => ({ toolName, output: outputs[i] })),
  })
  assert.equal(endsAfterReact({ steps: [step([REACT], [{ ok: true }])] }), true)
  assert.equal(endsAfterReact({ steps: [step([REACT], [{ ok: false, error: "x" }])] }), false)
  assert.equal(endsAfterReact({ steps: [step([REACT, "web_search"], [{ ok: true }, "x"])] }), false)
  assert.equal(endsAfterReact({ steps: [step(["web_search"], ["x"])] }), false)
  assert.equal(endsAfterReact({ steps: [] }), false)
})

test("Alte Tool-Eingaben verlieren langen Text bis auf den Anfang, neue bleiben, Ergebnis nennt die ID", () => {
  const long = "t".repeat(6000)
  const call = (id: string): ModelMessage =>
    ({ role: "assistant", content: [{ type: "tool-call", toolCallId: id, toolName: "create_file", input: { path: "a.md", text: long } }] }) as never
  const messages = [user("1"), call("a"), result("a", "x".repeat(500)), user("2"), user("3"), user("4"), user("5"), call("b"), result("b", "ok"), user("6")]
  const out = condenseOldToolResults(messages)
  const inputs = out.flatMap((m) => (m.role === "assistant" ? [(m.content as { input: { path: string; text: string } }[])[0]!.input] : []))
  assert.equal(inputs[0]!.path, "a.md")
  assert.ok(inputs[0]!.text.length < 400 && inputs[0]!.text.includes("5700 characters omitted"))
  assert.equal(inputs[1]!.text, long)
  const shortened = (out.find((m) => m.role === "tool")!.content[0] as { output: { value: string } }).output.value
  assert.match(shortened, /id a\]$/)
})
