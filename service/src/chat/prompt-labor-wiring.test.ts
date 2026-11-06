import assert from "node:assert/strict"
import test from "node:test"

import {
  FLEET_TOOLS_PROMPT_PLACEHOLDER,
  FOLLOW_UP_ROUTINE_PROMPT_PLACEHOLDER,
  GROK_CORE_STABLE_PLACEHOLDER,
  HAND_OFF_PROMPT_PLACEHOLDER,
  MAC_TOOLS_PROMPT_PLACEHOLDER,
  promptLayers,
  REPLY_HABITS_PLACEHOLDER,
  systemPrompt,
  TASK_TOOLS_PROMPT_PLACEHOLDER,
  WAKE_LABELS_PLACEHOLDER,
} from "../../../lib/chat/agent.ts"

const bot = { id: "a", name: "Orbi", job: "Hauptorbi", is_main: true, instructions: null, sandbox_id: null }
const ctx = { speaker: bot, team: [bot], members: [bot], isGroup: false, depth: 0, userId: "local" } as never
const set = (...names: string[]) => Object.fromEntries(names.map((n) => [n, {}])) as never

// Beide Wege (systemPrompt für den Turn, promptLayers für die Vorschau) müssen dieselben Blöcke tragen.
const both = (tools: never) => {
  const layers = promptLayers(ctx, tools, "", null)
  return [systemPrompt(ctx, tools, "", null), `${layers.layer1Stable}\n\n${layers.layer2Tools}`]
}

test("Prompt-Labor: stabile Blöcke immer, Werkzeug-Blöcke nur mit passendem Werkzeug, in beiden Wegen", () => {
  for (const block of [GROK_CORE_STABLE_PLACEHOLDER, REPLY_HABITS_PLACEHOLDER, WAKE_LABELS_PLACEHOLDER]) assert.ok(block.length > 50)
  for (const prompt of both(set())) {
    assert.ok(prompt.includes(GROK_CORE_STABLE_PLACEHOLDER))
    assert.ok(prompt.includes(REPLY_HABITS_PLACEHOLDER))
    assert.ok(prompt.includes(WAKE_LABELS_PLACEHOLDER))
    for (const block of [TASK_TOOLS_PROMPT_PLACEHOLDER, HAND_OFF_PROMPT_PLACEHOLDER, FOLLOW_UP_ROUTINE_PROMPT_PLACEHOLDER, FLEET_TOOLS_PROMPT_PLACEHOLDER, MAC_TOOLS_PROMPT_PLACEHOLDER])
      assert.equal(prompt.includes(block), false)
  }
  for (const prompt of both(set("run_task"))) assert.ok(prompt.includes(TASK_TOOLS_PROMPT_PLACEHOLDER))
  for (const prompt of both(set("hand_off"))) assert.ok(prompt.includes(HAND_OFF_PROMPT_PLACEHOLDER))
  for (const prompt of both(set("send_message"))) assert.ok(prompt.includes(HAND_OFF_PROMPT_PLACEHOLDER))
  for (const prompt of both(set("automation_create"))) assert.equal(prompt.includes(FOLLOW_UP_ROUTINE_PROMPT_PLACEHOLDER), false)
  for (const prompt of both(set("automation_create", "scratchpad"))) assert.ok(prompt.includes(FOLLOW_UP_ROUTINE_PROMPT_PLACEHOLDER))
  for (const prompt of both(set("list_orbis"))) assert.ok(prompt.includes(FLEET_TOOLS_PROMPT_PLACEHOLDER))
  for (const prompt of both(set("propose_profile"))) assert.ok(prompt.includes(FLEET_TOOLS_PROMPT_PLACEHOLDER))
  for (const prompt of both(set("mac_shell", "mac_files"))) assert.ok(prompt.includes(MAC_TOOLS_PROMPT_PLACEHOLDER))
  // Nirgends mehr ein Platzhalter-Hinweis.
  for (const prompt of both(set("run_task", "hand_off", "automation_create", "scratchpad", "list_orbis", "mac_shell"))) assert.doesNotMatch(prompt, /TODO/)
})
