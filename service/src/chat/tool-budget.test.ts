import "./fixtures/temp-data.ts"
import assert from "node:assert/strict"
import { test } from "node:test"
import { asSchema, type ToolSet } from "ai"

process.env.BRAIN_SERVER_URL = "http://127.0.0.1:1"
process.env.BRAIN_SERVER_TOKEN = "test"
const { baseOrbiTools, systemPrompt } = await import("../../../lib/chat/agent.ts")
const { askUserInput, ASK_USER_DESCRIPTION } = await import("../../../lib/chat/ask-user.ts")
const { createSendMessageTool } = await import("../../../lib/chat/send-message.ts")
const { createSayTool } = await import("../../../lib/chat/say.ts")
const { createReactTool } = await import("../../../lib/chat/reactions.ts")
const { automationCreateTool } = await import("../../../lib/chat/automation-tool.ts")
const { createOnboardingTool, createOrbisTool } = await import("../../../lib/chat/onboarding.ts")
const { tool } = await import("ai")
const { createRecallTool } = await import("../../../lib/chat/recall.ts")
const { UPGRADE_DESCRIPTION, upgradeInput } = await import("../../../lib/jev/upgrade.ts")
const { stepLabel, knownStepTools } = await import("../../../lib/chat/step-labels.ts")
const { DEFAULT_BASE_INSTRUCTIONS } = await import("../../../lib/orbi/base-instructions.ts")
const { ohnePromptLabor, PROMPT_LABOR_TOOLS } = await import("./fixtures/prompt-labor.ts")

const bot = { id: "a", name: "Orbi", job: "Hauptorbi", is_main: true, instructions: null, sandbox_id: "sb", avatar: "x", color: null }
const ctx = { speaker: bot, team: [bot], members: [bot], isGroup: false, depth: 0, userId: "local" } as never

function allTools(): ToolSet {
  return {
    ...baseOrbiTools(ctx),
    ask_user: tool({ description: ASK_USER_DESCRIPTION, inputSchema: askUserInput }),
    send_message: createSendMessageTool(async () => ({ ok: false, error: "x" })),
    say: createSayTool(),
    chat_recall: createRecallTool({ chatId: "c", sql: (async () => []) as never }),
    upgrade_model: tool({ description: UPGRADE_DESCRIPTION, inputSchema: upgradeInput }),
    react: createReactTool({ lastUserMessageId: () => undefined, set: async () => ({ ok: true }) }),
    automation_create: automationCreateTool(ctx),
    onboarding_finish: createOnboardingTool(async () => ({ ok: true })),
    onboarding_create_orbis: createOrbisTool({
      selected: () => null,
      reserve: async () => false,
      complete: async () => {},
      takenAvatars: () => [],
      avatars: ["a"],
      create: async () => ({ ok: false, error: "x" }),
      created: () => {},
    }),
  }
}

// Alle Beschreibungen (auch verschachtelte Parameter) eines JSON-Schemas.
function descriptions(schema: unknown, path: string, out: { path: string; text: string }[]) {
  if (!schema || typeof schema !== "object") return
  const node = schema as Record<string, unknown>
  if (typeof node.description === "string") out.push({ path, text: node.description })
  for (const key of ["properties", "$defs", "definitions"]) {
    const group = node[key]
    if (group && typeof group === "object")
      for (const [name, value] of Object.entries(group)) descriptions(value, `${path}.${name}`, out)
  }
  for (const key of ["items", "additionalProperties"]) descriptions(node[key], `${path}[]`, out)
  for (const key of ["anyOf", "oneOf", "allOf"]) {
    const list = node[key]
    if (Array.isArray(list)) list.forEach((v, i) => descriptions(v, `${path}|${i}`, out))
  }
}

test("Tool-Budget: Beschreibung höchstens 200 Zeichen (Prompt-Labor-Beschreibungen 800), jeder Parameter höchstens 80", () => {
  const tools = allTools()
  assert.ok(Object.keys(tools).length > 25)
  const problems: string[] = []
  for (const [name, def] of Object.entries(tools)) {
    const description = (def as { description?: string }).description ?? ""
    if (description.length > (PROMPT_LABOR_TOOLS.has(name) ? 800 : 200)) problems.push(`${name}: Beschreibung ${description.length}`)
    const found: { path: string; text: string }[] = []
    descriptions(asSchema((def as { inputSchema: never }).inputSchema).jsonSchema, name, found)
    for (const { path, text } of found) if (text.length > 80) problems.push(`${path}: Parameter ${text.length}`)
  }
  assert.deepEqual(problems, [])
})

test("Jedes eingebaute Werkzeug hat ein Status-Label oder bewusst keins", () => {
  for (const name of Object.keys(allTools()))
    assert.ok(knownStepTools().includes(name), `Label für ${name} fehlt`)
  // Labels sind Klartext ohne Befehle, Pfade oder Platzhalter.
  for (const name of knownStepTools()) {
    const label = stepLabel(name)
    if (label) assert.ok(label.length <= 40 && !/[/\\$`{}]/.test(label), name)
  }
  assert.equal(stepLabel("connector:abc:send_mail"), "Nutzt ein Plugin …")
  assert.equal(stepLabel("unbekannt"), "Arbeitet …")
})

test("Basis-Prompt ohne Brain und Gedächtnis liegt unter 5800 Zeichen (inkl. Fragekarten-Baustein, ohne die übrigen Prompt-Labor-Blöcke)", () => {
  const prompt = ohnePromptLabor(systemPrompt(ctx, allTools(), DEFAULT_BASE_INSTRUCTIONS, null))
  assert.ok(prompt.length < 5800, `Prompt ${prompt.length} Zeichen`)
})

test("Bildgenerierung wird nicht angeboten und der Prompt benennt die Grenze", () => {
  const tools = allTools()
  assert.equal("generate_image" in tools, false)
  assert.match(systemPrompt(ctx, tools, DEFAULT_BASE_INSTRUCTIONS, null), /Image generation is currently unavailable/)
})
