import assert from "node:assert/strict"
import test from "node:test"

import { validateGroupMemberCount } from "./limits.ts"

test("Gruppenlimit lässt sechs Mitglieder zu und weist mehr ab", () => {
  assert.equal(validateGroupMemberCount(6), null)
  assert.equal(validateGroupMemberCount(7), "Höchstens 6 Orbis je Gruppe")
})
