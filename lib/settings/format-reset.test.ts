// Start: node --test lib/settings/format-reset.test.ts
import assert from "node:assert/strict"
import { test } from "node:test"

import { formatReset } from "./format-reset.ts"

const NOW = Date.UTC(2026, 9, 17, 12, 0)
const MIN = 60_000

test("unter einem Tag: Stunden und Minuten", () => {
  assert.equal(formatReset(NOW + 130 * MIN, NOW), "Reset in 2 h 10 min")
})

test("glatte Stunde und nur Minuten", () => {
  assert.equal(formatReset(NOW + 120 * MIN, NOW), "Reset in 2 h")
  assert.equal(formatReset(NOW + 5 * MIN, NOW), "Reset in 5 min")
})

test("Sekundenrest rundet auf die nächste Minute", () => {
  assert.equal(formatReset(NOW + 1000, NOW), "Reset in 1 min")
})

test("ab einem Tag: Wochentag und Uhrzeit", () => {
  assert.match(
    formatReset(NOW + 3 * 24 * 60 * MIN, NOW),
    /^Reset [A-Z][a-z]\.?, \d{2}:\d{2}$/
  )
})

test("abgelaufen", () => {
  assert.equal(formatReset(NOW - MIN, NOW), "Reset steht an")
})
