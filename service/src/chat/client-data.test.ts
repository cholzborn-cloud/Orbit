import assert from "node:assert/strict"
import test from "node:test"

import { localClientDataSchema } from "./client-data.ts"

test("Ältere App-Versionen: approvalMode wird still ignoriert, auch plan", () => {
  for (const approvalMode of ["plan", "ask", "allow_all", "auto", "unbekannt"]) {
    const parsed = localClientDataSchema.safeParse({ model: "m", approvalMode })
    assert.equal(parsed.success, true, approvalMode)
    if (parsed.success) assert.equal("approvalMode" in parsed.data, false)
  }
  assert.deepEqual(localClientDataSchema.parse({ model: "m" }), { model: "m", context: true })
})

test("Auftrags- und Wecken-Felder kommen nie vom Browser, modelPinned schon", () => {
  const parsed = localClientDataSchema.parse({
    model: "claude-sonnet-5-5",
    modelPinned: true,
    rootTaskId: "fremd",
    rootChatId: "fremd",
    wake: { kind: "reply", linkIds: ["x"] },
    handoffFrom: "bot",
    ownerId: "other",
  })
  assert.deepEqual(parsed, { model: "claude-sonnet-5-5", modelPinned: true, context: true })
})
