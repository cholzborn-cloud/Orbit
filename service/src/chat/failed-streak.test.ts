import assert from "node:assert/strict"
import test from "node:test"

import { failedStreak } from "./failed-streak.ts"

const bad = { content: [{ type: "tool-result", output: { error: "x" } }] }
const err = { content: [{ type: "tool-error" }] }
const good = { content: [{ type: "tool-result", output: { ok: true } }] }
test("Fehlschlag-Serie zählt nur am Ende und nur reine Fehlschläge", () => {
  assert.equal(failedStreak([bad, bad, err]), 3)
  assert.equal(failedStreak([bad, good, bad]), 1)
  assert.equal(failedStreak([good]), 0)
  assert.equal(failedStreak([]), 0)
  assert.equal(failedStreak([{ content: [{ type: "text" }] }]), 0)
})
