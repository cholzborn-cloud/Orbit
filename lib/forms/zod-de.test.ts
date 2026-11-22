import assert from "node:assert/strict"
import test from "node:test"

import { z } from "zod"
import "./zod-de.ts"

test("Zod-Standardmeldungen erscheinen auf Deutsch", () => {
  const result = z.string().max(40).safeParse("x".repeat(41))
  assert.equal(result.success, false)
  if (!result.success) {
    assert.match(result.error.issues[0].message, /^Zu groß:/)
    assert.doesNotMatch(result.error.issues[0].message, /expected|too big/i)
  }
})
