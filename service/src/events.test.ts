import assert from "node:assert/strict"
import test from "node:test"

import { EventHub } from "./events.ts"

const decode = (data: Uint8Array | undefined) => new TextDecoder().decode(data)
test("Ereignisse beginnen mit aktuellem Snapshot und folgen live; Leser können sich abmelden", async () => {
  const hub = new EventHub()
  const response = hub.response(() => ({ pending: [{ id: "one" }] }))
  const reader = response.body!.getReader()
  assert.match(decode((await reader.read()).value), /"type":"snapshot"/)
  hub.publish({
    type: "status",
    chatId: "chat",
    botId: "bot",
    status: "wartet",
  })
  assert.match(decode((await reader.read()).value), /"status":"wartet"/)
  await reader.cancel()
  hub.publish({
    type: "status",
    chatId: "chat",
    botId: "bot",
    status: "fertig",
  })
  const fresh = hub.response(() => ({ pending: [] })).body!.getReader()
  assert.match(decode((await fresh.read()).value), /"pending":\[\]/)
  await fresh.cancel()
})

test("Langsame Kanäle enden sichtbar, statt Ereignisse still zu verlieren", async () => {
  const hub = new EventHub(15_000, 1)
  const reader = hub.response(() => ({})).body!.getReader()
  hub.publish({
    type: "status",
    chatId: "chat",
    botId: "bot",
    status: "arbeitet",
  })
  await assert.rejects(reader.read(), /zu langsam/)
})
