import assert from "node:assert/strict"
import test from "node:test"

import { needsRetryHint } from "./needs-retry-hint.ts"

test("zeigt den Hinweis nur bei geladener, unbeantworteter Nutzernachricht", () => {
  assert.equal(
    needsRetryHint({
      messages: [{ role: "user" }],
      status: "ready",
      restored: true,
    }),
    true
  )
  assert.equal(
    needsRetryHint({
      messages: [{ role: "user" }],
      status: "streaming",
      restored: true,
    }),
    false
  )
  assert.equal(
    needsRetryHint({
      messages: [{ role: "assistant" }],
      status: "ready",
      restored: true,
    }),
    false
  )
  assert.equal(
    needsRetryHint({
      messages: [{ role: "user" }],
      status: "ready",
      restored: false,
    }),
    false
  )
})
