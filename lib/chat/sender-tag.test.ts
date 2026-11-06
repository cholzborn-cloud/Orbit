// Start: node --test lib/chat/sender-tag.test.ts
import assert from "node:assert/strict"
import { test } from "node:test"

import { senderTagRe } from "./sender-tag.ts"

const strip = (names: string[], text: string) =>
  text.replace(senderTagRe(names), "")

test("entfernt Marker samt Leerraum am Anfang", () => {
  assert.equal(strip(["Max"], "[Max]: Hallo"), "Hallo")
  assert.equal(strip(["Max"], "  [Max]:\n  Hallo"), "Hallo")
})

test("Sonderzeichen im Namen werden wörtlich genommen", () => {
  for (const name of [
    "C++",
    "Dr. Who",
    "Orbi (2)",
    "Q?",
    "[x]",
    "$&",
    "a\\b",
  ]) {
    assert.equal(strip([name], `[${name}]: Text`), "Text", name)
  }
})

test("Sonderzeichen wirken nicht als Regex", () => {
  assert.equal(strip(["Dr. Who"], "[DrX Who]: Text"), "[DrX Who]: Text")
  assert.equal(strip(["a|b"], "[a]: Text"), "[a]: Text")
  assert.equal(strip(["a|b"], "[b]: Text"), "[b]: Text")
  assert.equal(strip(["C++"], "[C]: Text"), "[C]: Text")
})

test("nur bekannte Namen und nur am Anfang", () => {
  assert.equal(strip(["Max"], "[Eva]: Hallo"), "[Eva]: Hallo")
  assert.equal(strip(["Max"], "Hallo [Max]: Text"), "Hallo [Max]: Text")
  assert.equal(strip(["Max"], "[Max] Hallo"), "[Max] Hallo")
})

test("mehrere Namen, auch wenn einer Präfix des anderen ist", () => {
  const names = ["Ana", "Ana Maria"]
  assert.equal(strip(names, "[Ana Maria]: Hi"), "Hi")
  assert.equal(strip(names, "[Ana]: Hi"), "Hi")
})
