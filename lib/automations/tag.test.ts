import assert from "node:assert/strict"
import { test } from "node:test"

import { parseAutomationPrompt, tagAutomationPrompt } from "./tag.ts"

test("Automations-Kennzeichen: Rundlauf und normaler Text", () => {
  const tagged = tagAutomationPrompt("Morgen [1]", "Sag Hallo\nzweite Zeile")
  assert.deepEqual(parseAutomationPrompt(tagged), {
    name: "Morgen  1 ",
    prompt: "Sag Hallo\nzweite Zeile",
  })
  assert.equal(parseAutomationPrompt("Hallo"), null)
})
