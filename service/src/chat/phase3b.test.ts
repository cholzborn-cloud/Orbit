import assert from "node:assert/strict"
import { test } from "node:test"

process.env.BRAIN_SERVER_URL = "http://127.0.0.1:1"
process.env.BRAIN_SERVER_TOKEN = "test"
const { systemPrompt } = await import("../../../lib/chat/agent.ts")
const { failureText, noticeFor, createNoticeGate } = await import("../../../lib/chat/notice.ts")
const { onboardingHint, selectedAnswers, selectedOrbis, createOrbisTool, ORBI_QUESTION } = await import("../../../lib/chat/onboarding.ts")

const opts = { toolCallId: "t", messages: [] } as never
const bot = { id: "a", name: "Orbi", job: "Hauptorbi", is_main: true, instructions: null, sandbox_id: "sb", avatar: "x", color: null }
const ctx = { speaker: bot, team: [bot], members: [bot], isGroup: false, depth: 0, userId: "local" } as never

test("Prompt: immer die Kurz-Zeile, keine Stufen", () => {
  const prompt = systemPrompt(ctx, {})
  assert.ok(prompt.includes("result first, usually 1-5 lines"))
  assert.ok(!/Reply length|detailed|normal\./.test(prompt))
})

test("Hinweis: Wiederholung oder Aktion, kurz und ohne Technik", () => {
  assert.deepEqual(noticeFor("web_search", "ETIMEDOUT while fetching"), { kind: "retry", text: "Versuche es erneut …" })
  assert.deepEqual(noticeFor("connector:x", "Konnektor Notion: Zugang verweigert (401). Anmeldung oder Schlüssel nötig."), {
    kind: "action",
    text: "Bitte verbinde Notion neu.",
  })
  assert.equal(noticeFor("bash", "Permission denied")?.text, "Bitte erlaube den Zugriff.")
  assert.equal(noticeFor("ask_user", "x"), null)
  assert.equal(failureText({ type: "tool-output-available", output: { ok: true } }), null)
  assert.equal(failureText({ type: "tool-output-available", output: { error: "kaputt" } }), "kaputt")
  assert.equal(failureText({ type: "tool-output-error", errorText: "boom" }), "boom")
  assert.equal(failureText({ type: "tool-output-denied" }), null)
})

test("Hinweis-Sperre: höchstens 3 je Turn, nie derselbe Text zweimal hintereinander", () => {
  const gate = createNoticeGate()
  const retry = noticeFor("bash", "x")
  assert.ok(gate(retry))
  assert.equal(gate(retry), null)
  assert.ok(gate(noticeFor("bash", "401")))
  assert.ok(gate(retry))
  assert.equal(gate(noticeFor("bash", "401")), null)
})

test("Onboarding-Hinweis: Hauptorbi mit Diensten, Orbi mit erster Aufgabe", () => {
  const main = onboardingHint({ name: "Haupt", job: "Hauptorbi", avatar: "x", is_main: true }, ["DeepWiki", "Context7"])
  assert.match(main, /DeepWiki, Context7/)
  assert.match(main, /onboarding_create_orbis/)
  assert.match(main, /never create anything unchosen/)
  const other = onboardingHint({ name: "Lara", job: "Lernen", avatar: "x" })
  assert.match(other, /first task/)
  assert.ok(!other.includes("onboarding_create_orbis"))
  assert.ok(main.length < 1800 && other.length < 1200)
})

test("Orbis anlegen: nur ausgewählte, höchstens 3, einmal, mit freiem Avatar", async () => {
  const messages = [
    {
      role: "assistant",
      parts: [
        {
          type: "tool-ask_user",
          state: "output-available",
          toolCallId: "auswahl",
          input: { onboardingOrbiSelection: true, questions: [{ question: ORBI_QUESTION, multiple: true, options: [{ label: "Lernhilfe", description: "Lernen" }, { label: "Planer", description: "Planen" }] }] },
          output: { answers: [{ question: ORBI_QUESTION, answers: ["Lernhilfe", "Planer"] }] },
        },
        { type: "tool-ask_user", state: "input-available" },
      ],
    },
  ]
  assert.deepEqual([...selectedAnswers(messages)!.choices.keys()].sort(), ["lernhilfe", "planer"])
  assert.equal(selectedOrbis("x", { questions: [{ question: "Dienste?" }] }, { answers: [{ question: "Dienste?", answers: ["Lernhilfe"] }] }), null)
  const made: string[] = []
  let events = 0
  const tool = createOrbisTool({
    selected: () => selectedAnswers(messages),
    reserve: async () => true,
    complete: async () => {},
    takenAvatars: () => ["strobi"],
    avatars: ["strobi", "freddy", "citrus"],
    create: async (o) => {
      made.push(`${o.name}|${o.avatar}|${o.color}`)
      return { ok: true, id: `id-${o.name}`, chatId: `chat-${o.name}` }
    },
    created: () => void events++,
  }) as unknown as { execute: (i: unknown, o: unknown) => Promise<{ ok: boolean }> }
  const refused = await tool.execute({ orbis: [{ name: "Lernhilfe", job: "Lernen" }, { name: "Heimlich", job: "x" }] }, opts)
  assert.equal(refused.ok, false)
  assert.equal((await tool.execute({ orbis: [{ name: "Lernhilfe", job: "Anderes" }, { name: "Planer", job: "Planen" }] }, opts)).ok, false)
  assert.equal((await tool.execute({ orbis: [{ name: "Lernhilfe", job: "Lernen" }, { name: "Lernhilfe", job: "Lernen" }] }, opts)).ok, false)
  assert.deepEqual(made, [])
  const ok = await tool.execute({ orbis: [{ name: "Lernhilfe", job: "Lernen", color: "#112233" }, { name: "planer", job: "Planen", color: "rot" }] }, opts)
  assert.equal(ok.ok, true)
  assert.deepEqual(made, ["Lernhilfe|freddy|#112233", "planer|citrus|#4A90E2"])
  assert.equal(events, 1)
  assert.equal((await tool.execute({ orbis: [{ name: "Lernhilfe", job: "Lernen" }] }, opts)).ok, false)
  assert.equal(made.length, 2)
})

test("Eine bestätigte Karte kann nicht über mehrere Werkzeuginstanzen erneut verwendet werden", async () => {
  const input = { onboardingOrbiSelection: true, questions: [{ question: ORBI_QUESTION, multiple: true, options: [{ label: "A", description: "Lernen" }, { label: "B", description: "Planen" }] }] }
  const selection = selectedOrbis("auswahl", input, { answers: [{ question: ORBI_QUESTION, answers: ["A"] }] })!
  assert.equal(selectedOrbis("auswahl", input, { answers: [{ question: ORBI_QUESTION, answers: ["Andere"] }] }), null)
  let consumed = false, count = 0
  const make = () => createOrbisTool({ selected: () => selection, reserve: async () => { if (consumed) return false; consumed = true; return true }, complete: async () => {}, takenAvatars: () => [], avatars: ["a"], create: async () => { count++; return { ok: true, id: "a", chatId: "c" } }, created: () => {} }) as unknown as { execute: (i: unknown, o: unknown) => Promise<{ ok: boolean }> }
  const request = { orbis: [{ name: "A", job: "Lernen" }] }
  assert.equal((await make().execute(request, opts)).ok, true)
  assert.equal((await make().execute(request, opts)).ok, false)
  assert.equal(count, 1)
})

test("Teilweise Anlage nennt dem Modell die bereits angelegten Orbis", async () => {
  const input = { onboardingOrbiSelection: true, questions: [{ question: ORBI_QUESTION, multiple: true, options: [{ label: "A", description: "Lernen" }, { label: "B", description: "Planen" }] }] }
  const selection = selectedOrbis("teilfehler", input, { answers: [{ question: ORBI_QUESTION, answers: ["A", "B"] }] })!
  let calls = 0
  const t = createOrbisTool({ selected: () => selection, reserve: async () => true, complete: async () => {}, takenAvatars: () => [], avatars: ["a"], create: async () => ++calls === 1 ? { ok: true, id: "a", chatId: "c" } : { ok: false, error: "Nicht erreichbar" }, created: () => {} })
  const output = await t.execute!({ orbis: [{ name: "A", job: "Lernen" }, { name: "B", job: "Planen" }] }, opts)
  const modelOutput = await t.toModelOutput!({ toolCallId: "x", input: { orbis: [] }, output } as never)
  assert.match(JSON.stringify(modelOutput), /Bereits angelegt: A/)
  assert.match(JSON.stringify(modelOutput), /neue Auswahl/)
  const failed = await t.toModelOutput!({ toolCallId: "x", input: { orbis: [] }, output: { ok: false, error: "Nicht erreichbar", created: [] } } as never)
  assert.match(JSON.stringify(failed), /Noch kein Orbi angelegt/)
  assert.match(JSON.stringify(failed), /neue Auswahl/)
})
