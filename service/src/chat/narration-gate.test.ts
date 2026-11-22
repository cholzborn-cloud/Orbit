import assert from "node:assert/strict"
import test from "node:test"

import { createNarrationGate, similarNarration, type GateChunk } from "./narration-gate.ts"

function setup(startedAt = 0, extra: Partial<Parameters<typeof createNarrationGate>[0]> = {}) {
  let clock = startedAt
  const timers: { at: number; run: () => void; live: boolean }[] = []
  const out: GateChunk[] = []
  const gate = createNarrationGate({
    startedAt,
    emit: (chunk) => out.push(chunk),
    now: () => clock,
    setTimer: (run, ms) => { const timer = { at: clock + ms, run, live: true }; timers.push(timer); return () => { timer.live = false } },
    ...extra,
  })
  const advance = (ms: number) => {
    clock += ms
    for (const timer of timers) if (timer.live && timer.at <= clock) { timer.live = false; timer.run() }
  }
  return { gate, out, advance, at: () => clock }
}
const narration = (id: string, text: string): GateChunk[] => [
  { type: "text-start", id, providerMetadata: { orbit: { narration: true } } },
  { type: "text-delta", id, delta: text },
  { type: "text-end", id },
]
const call = (id: string): GateChunk[] => [{ type: "tool-input-start", toolCallId: id, toolName: "mac_shell" }, { type: "tool-input-available", toolCallId: id, toolName: "mac_shell" }]
const result = (id: string): GateChunk => ({ type: "tool-output-available", toolCallId: id })
const types = (out: GateChunk[]) => out.map((chunk) => chunk.type)

test("Tor: schnelle Werkzeuge in einem jungen Auftrag bekommen keine Ankündigung", () => {
  const { gate, out, advance } = setup()
  gate.push({ type: "start-step" })
  for (const chunk of [...narration("0", "Ich prüfe das Wetter."), ...call("a")]) gate.push(chunk)
  assert.deepEqual(types(out), ["start-step"], "noch nichts durch")
  advance(2000)
  gate.push(result("a"))
  assert.deepEqual(types(out), ["start-step", "tool-input-start", "tool-input-available", "tool-output-available"])
  assert.ok(!out.some((chunk) => chunk.type.startsWith("text-")))
})

test("Tor: läuft das Werkzeug länger, erscheint die Ankündigung nach der Mindestzeit und vor dem Werkzeug", () => {
  const { gate, out, advance } = setup()
  for (const chunk of [...narration("0", "Ich suche die Dateien."), ...call("a")]) gate.push(chunk)
  advance(7999)
  assert.equal(out.length, 0)
  advance(2)
  assert.deepEqual(types(out), ["text-start", "text-delta", "text-end", "tool-input-start", "tool-input-available"])
  gate.push(result("a"))
  assert.equal(out.at(-1)!.type, "tool-output-available")
})

test("Tor: ist der Auftrag schon alt (langsames Modell), erscheint die Ankündigung sofort", () => {
  const { gate, out, advance } = setup()
  advance(12_000)
  for (const chunk of [...narration("0", "Ich lese die Datei."), ...call("a")]) gate.push(chunk)
  assert.deepEqual(types(out), ["text-start", "text-delta", "text-end", "tool-input-start", "tool-input-available"])
})

test("Tor: keine Wiederholung und höchstens zwei pro Auftrag", () => {
  const { gate, out, advance } = setup()
  advance(10_000)
  for (const chunk of [...narration("0", "Ich prüfe das aktuelle Wetter in München."), ...call("a")]) gate.push(chunk)
  gate.push(result("a"))
  advance(20_000)
  for (const chunk of [...narration("1", "Ich prüfe das aktuelle Wetter in München noch einmal."), ...call("b")]) gate.push(chunk)
  gate.push(result("b"))
  assert.equal(out.filter((chunk) => chunk.type === "text-start").length, 1, "Wiederholung entfällt")
  advance(20_000)
  for (const chunk of [...narration("2", "Ich sehe in den Ordner Schule."), ...call("c")]) gate.push(chunk)
  gate.push(result("c"))
  advance(20_000)
  for (const chunk of [...narration("3", "Jetzt zähle ich die Dateien."), ...call("d")]) gate.push(chunk)
  assert.equal(out.filter((chunk) => chunk.type === "text-start").length, 2, "mehr als zwei nie")
})

test("Tor: zu dichter Abstand entfällt", () => {
  const { gate, out, advance } = setup()
  advance(10_000)
  for (const chunk of [...narration("0", "Ich suche im Ordner Schule."), ...call("a")]) gate.push(chunk)
  gate.push(result("a"))
  advance(3000)
  for (const chunk of [...narration("1", "Danach zähle ich die Treffer."), ...call("b")]) gate.push(chunk)
  assert.equal(out.filter((chunk) => chunk.type === "text-start").length, 1)
})

test("Tor: Antworttext, Rückfragen und Freigaben laufen sofort; eine Rückfrage gibt die Ankündigung frei", () => {
  const { gate, out } = setup()
  gate.push({ type: "text-start", id: "x" })
  gate.push({ type: "text-delta", id: "x", delta: "Antwort" })
  assert.equal(out.length, 2)
  for (const chunk of narration("0", "Ich frage kurz nach.")) gate.push(chunk)
  gate.push({ type: "tool-input-start", toolCallId: "q", toolName: "ask_user" })
  gate.push({ type: "tool-input-available", toolCallId: "q", toolName: "ask_user" })
  assert.ok(out.some((chunk) => chunk.type === "text-delta" && chunk.delta === "Ich frage kurz nach."))
})

test("Tor: Zwischennachricht über say ersetzt die Ankündigung", () => {
  const { gate, out } = setup()
  for (const chunk of narration("0", "Ich starte.")) gate.push(chunk)
  gate.push({ type: "tool-input-available", toolCallId: "s", toolName: "say" })
  assert.ok(!out.some((chunk) => chunk.type.startsWith("text-")))
  assert.equal(out.at(-1)!.toolName, "say")
})

test("Tor: Ende des Stroms lässt nichts hängen", () => {
  const { gate, out } = setup()
  for (const chunk of [...narration("0", "Ich prüfe."), ...call("a")]) gate.push(chunk)
  gate.end()
  assert.deepEqual(types(out), ["tool-input-start", "tool-input-available"])
})

test("Ähnlichkeit", () => {
  assert.ok(similarNarration("Ich prüfe das aktuelle Wetter in München.", "Ich prüfe das aktuelle Wetter in München noch einmal."))
  assert.ok(!similarNarration("Ich suche die Dateien.", "Ich zähle die Treffer im Archiv."))
})

test("Tor: „Fertig.“ vor einem Werkzeug ist keine Ankündigung", () => {
  const { gate, out, advance } = setup()
  advance(12_000)
  for (const chunk of [...narration("0", "Fertig."), ...call("a")]) gate.push(chunk)
  assert.ok(!out.some((chunk) => chunk.type.startsWith("text-")))
})
