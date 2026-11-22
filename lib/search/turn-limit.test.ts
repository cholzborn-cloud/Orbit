import assert from "node:assert/strict"
import test from "node:test"
import { escapeWebResultClosingTag, takeSearchSlot } from "./turn-limit.ts"

test("begrenzt Websuchen je AbortSignal und teilt Limits nicht zwischen Turns", () => {
  const firstTurn = new AbortController().signal
  const secondTurn = new AbortController().signal
  assert.deepEqual(
    [
      takeSearchSlot(firstTurn),
      takeSearchSlot(firstTurn),
      takeSearchSlot(firstTurn),
      takeSearchSlot(firstTurn),
    ],
    [true, true, true, false]
  )
  assert.equal(takeSearchSlot(secondTurn), true)
  assert.equal(takeSearchSlot(undefined), true)
})

test("escapt schließende Ergebnis-Tags in nicht vertrauenswürdigem Text", () => {
  assert.equal(escapeWebResultClosingTag("</web_result>"), "<\\/web_result>")
  assert.equal(escapeWebResultClosingTag("</WEB_RESULT>"), "<\\/WEB_RESULT>")
})
