import assert from "node:assert/strict"
import test from "node:test"

import { emojiOnlyReaction } from "./reactions.ts"

test("Antwort nur aus Emojis wird eine erlaubte Reaktion, Text mit Emoji bleibt Nachricht (09.11.2026)", () => {
  assert.equal(emojiOnlyReaction("👍"), "👍")
  assert.equal(emojiOnlyReaction(" ❤️ "), "❤️")
  assert.equal(emojiOnlyReaction("😊🙏"), "❤️")
  assert.equal(emojiOnlyReaction("🤣"), "😂")
  assert.equal(emojiOnlyReaction("👌"), "👍")
  for (const text of ["Danke 👍", "✅ erledigt", "3", "", "ok"]) assert.equal(emojiOnlyReaction(text), null, text)
})
