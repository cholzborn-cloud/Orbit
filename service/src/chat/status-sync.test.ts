import assert from "node:assert/strict"
import test from "node:test"

import { alignWaiting } from "./status-sync"

test("Elternchat zeigt wartet, solange der Unterauftrag wartet, und danach wieder arbeitet", () => {
  const working = new Map([
    [
      "parent",
      {
        type: "status",
        chatId: "parent",
        botId: "nepi",
        status: "arbeitet",
      } as const,
    ],
    [
      "child",
      {
        type: "status",
        chatId: "child",
        botId: "marsi",
        status: "wartet",
      } as const,
    ],
    [
      "other",
      {
        type: "status",
        chatId: "other",
        botId: "erdi",
        status: "arbeitet",
      } as const,
    ],
  ])
  const calls: string[] = []
  const set = (chatId: string, botId: string, status: string) => {
    calls.push(`${chatId}:${status}`)
    working.set(chatId, { type: "status", chatId, botId, status } as never)
  }
  alignWaiting(working, new Set(["parent", "child"]), set)
  assert.deepEqual(calls, ["parent:wartet"])
  calls.length = 0
  alignWaiting(working, new Set(), set)
  assert.deepEqual(calls.sort(), ["child:arbeitet", "parent:arbeitet"])
})
