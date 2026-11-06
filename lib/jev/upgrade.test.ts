import assert from "node:assert/strict"
import test from "node:test"

import { CHAT_MODELS } from "../chat-catalog.ts"
import { chooseUpgrade } from "./upgrade.ts"

const haiku = CHAT_MODELS.find((model) => model.id === "claude-haiku-5-5")!
const opus = CHAT_MODELS.find((model) => model.id === "claude-opus-5-5")!

test("Hochstufung respektiert feste Wahl und wechselt nur auf höheren Rang", async () => {
  const base = { current: haiku, kind: "large" as const, available: async () => true }
  assert.equal((await chooseUpgrade({ ...base, pinned: false }))?.model.id, opus.id)
  assert.equal(await chooseUpgrade({ ...base, pinned: true }), undefined)
  assert.equal(await chooseUpgrade({ ...base, current: opus, pinned: false }), undefined)
  assert.equal(await chooseUpgrade({ ...base, tier: "coding", pinned: false }), undefined)
})

test("Hochstufung nutzt den anderen starken Anbieter nur wenn verfügbar", async () => {
  const base = { current: haiku, pinned: false, kind: "coding" as const }
  assert.equal((await chooseUpgrade({ ...base, available: async (model) => model.id === opus.id }))?.model.id, opus.id)
  assert.equal(await chooseUpgrade({ ...base, available: async () => false }), undefined)
})
