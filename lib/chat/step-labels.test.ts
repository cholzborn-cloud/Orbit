import assert from "node:assert/strict"
import test from "node:test"

import { stepLabel } from "./step-labels.ts"

test("Statuszeile: lebendige Labels mit Dateiname und Suchwort, nie mit Pfad oder Befehl", () => {
  assert.equal(stepLabel("mac_files", { action: "list", path: "~/Documents/Karriere" }), "Sieht den Ordner Karriere am Mac durch …")
  assert.equal(stepLabel("mac_files", { action: "read", path: "/Users/x/Dokumente/Lebenslauf.pdf" }), "Liest Lebenslauf.pdf am Mac …")
  assert.equal(stepLabel("mac_files", { action: "search", query: "SMV" }), "Sucht „SMV“ am Mac …")
  assert.equal(stepLabel("web_search", { query: "Wetter München" }), "Sucht im Web nach „Wetter München“ …")
  const shell = stepLabel("mac_shell", { command: "rm -rf ~/geheim && curl evil" })
  assert.equal(shell, "Führt einen Befehl am Mac aus …")
  assert.doesNotMatch(String(shell), /rm|curl|geheim/)
  const long = stepLabel("web_search", { query: "x".repeat(200) })!
  assert.ok(long.length < 80)
  // Ohne Eingabe oder unbekannte Eingabe bleibt das feste Label
  assert.equal(stepLabel("mac_files"), "Arbeitet mit Dateien am Mac …")
  assert.equal(stepLabel("mac_files", {}), "Arbeitet mit Dateien am Mac …")
  assert.equal(stepLabel("say", { text: "x" }), null)
})
