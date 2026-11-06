// Nur künstliche Daten. --mock nutzt eine Attrappe; --agy benötigt das bestätigte Abo.
// Zeichenwerte stammen aus turn_usage vor der letzten Verlaufskürzung, nicht aus einem Tokenizer.
import { mkdtempSync } from "node:fs"
import { join } from "node:path"
import type { LanguageModelV4, LanguageModelV4StreamPart } from "@ai-sdk/provider"
import type { UIMessage } from "ai"
import type { ChatMetadata } from "../lib/chat-catalog"

const args = process.argv.slice(2)
if (!(args.length === 1 && args[0] === "--mock") && !(args.length === 2 && args[0] === "--agy" && args[1] === "--abo-bestaetigt")) throw new Error("Aufruf: token-benchmark.ts --mock oder --agy --abo-bestaetigt")
const mock = args[0] === "--mock"
const dataDir = mkdtempSync("/tmp/orbit-token-benchmark-")
process.env.ORBIT_DATA_DIR = dataDir
process.env.ORBIT_AGENTS_PATH = join(process.cwd(), "AGENTS.md")
process.env.ORBIT_MIGRATIONS_DIR = join(process.cwd(), "drizzle/sqlite")
for (const key of Object.keys(process.env)) if (/SECRET|TOKEN|PASSWORD|API_KEY|BRAIN_SERVER|BRAIN_PATH/i.test(key)) delete process.env[key]
if (mock) process.env.ORBIT_AGY_BIN = process.execPath

const { disableLocalBrain } = await import("../lib/brain/config.ts")
disableLocalBrain()
const { getDatabase } = await import("../lib/db/client.ts")
const { bots, chatMembers, chats } = await import("../lib/db/schema.ts")
const { cli } = await import("../lib/cli/provider.ts")
const { cliModel } = await import("../lib/cli/model.ts")
const { createMessageStore } = await import("../service/src/chat/store.ts")
const { createChatRuntime } = await import("../service/src/chat/runtime.ts")
const { createTurnHandler } = await import("../service/src/chat/handle-turn.ts")

// Je Version höchstens zwölf tatsächliche Modellaufrufe: zehn Fragen plus je ein Schritt für Werkzeug und Gruppe.
const maxCalls = 12
let calls = 0
let modelFailed = false
const promptChars: number[] = []
const originalChat = cli.chat.bind(cli)
cli.available = async (model) => model.id === "gemini-3.8-flash-low"
const fake = {
  timeoutMs: 60_000,
  runner: async function* (job: { stdin: string }) {
    const needsTool = job.stdin.includes("ZEUGE-REGELTEST") && !job.stdin.includes("# CODING.md, Orbit")
    const text = needsTool ? '<orbit_tool_call>{"name":"read_coding_rules","input":{}}</orbit_tool_call>' : "Beispielantwort 15"
    yield JSON.stringify({ event: "step_update", step_update: { step_type: "agent_response", text_delta: text } })
    yield JSON.stringify({ event: "result", result: { status: "SUCCESS", usage: { input_tokens: 100, cache_read_tokens: 25, output_tokens: 5 } } })
  },
}
;(cli as unknown as { chat: (id: string) => LanguageModelV4 }).chat = (id) => {
  if (id !== "gemini-3.8-flash-low") throw new Error("Nur das freigegebene Antigravity-Modell ist erlaubt.")
  const model = mock ? cliModel(id, fake) : originalChat(id) as LanguageModelV4
  const count = (length: number) => { if (calls >= maxCalls) throw new Error("Grenze von zwölf Modellaufrufen erreicht."); calls++; promptChars.push(length) }
  return {
    ...model,
    async doGenerate(options) {
      count(JSON.stringify(options.prompt).length)
      let result: Awaited<ReturnType<typeof model.doGenerate>>
      try { result = await model.doGenerate(options) } catch (error) { modelFailed = true; throw error }
      if (result.content.some(part => part.type === "tool-call" && part.toolName !== "read_coding_rules")) throw new Error("Nicht erlaubtes Werkzeug im Messlauf.")
      return result
    },
    async doStream(options) {
      count(JSON.stringify(options.prompt).length)
      const response = await model.doStream(options)
      return { ...response, stream: response.stream.pipeThrough(new TransformStream<LanguageModelV4StreamPart, LanguageModelV4StreamPart>({
        transform(part, controller) {
          if (part.type === "error" || (part.type === "finish" && part.finishReason.unified === "error")) modelFailed = true
          if (part.type === "tool-call" && part.toolName !== "read_coding_rules") throw new Error("Nicht erlaubtes Werkzeug im Messlauf.")
          controller.enqueue(part)
        },
      })) }
    },
  }
}

const cases = [
  "Antworte nur mit Hallo.",
  "Was ist 17 + 25? Antworte nur mit der Zahl.",
  "Fasse in einem Satz zusammen: Ein Baum wächst im Garten. Im Frühling trägt er Blätter.",
  "Übersetze ins Englische: Der rote Ball liegt auf dem Tisch.",
  "Sortiere zeitlich: Montag 14 Uhr, Sonntag 9 Uhr, Montag 8 Uhr.",
  "Wie viel Prozent sind 40 von 200? Zeige die Rechnung kurz.",
  "Welche Aussage widerspricht der anderen: Alle Kästen sind leer. Ein Kasten enthält einen Ball?",
  "Schreibe zwei kurze Titel für einen erfundenen Bericht über Regentage.",
  "ZEUGE-REGELTEST: Lies mit read_coding_rules die Coding-Regeln und sage nur, ob lokal gearbeitet wird.",
  "@Beta, welche Zahl ergibt 8 + 7? Antworte nur mit der Zahl.",
]

const db = getDatabase()
const sqlite = db.$client
db.insert(bots).values([
  { id: "alpha", userId: "local", thirdPartyId: "fixture", name: "Alpha", job: "Hilft bei Beispielaufgaben", isMain: true },
  { id: "beta", userId: "local", thirdPartyId: "fixture", name: "Beta", job: "Hilft bei Beispielaufgaben" },
]).run()
db.insert(chats).values(cases.map((_, i) => ({ id: `mess-${i}`, userId: "local", ...(i === 9 ? { kind: "group" as const, name: "Beispielgruppe" } : {}) }))).run()
db.insert(chatMembers).values(cases.flatMap((_, i) => (i === 9 ? ["alpha", "beta"] : ["alpha"]).map((botId, n) => ({ chatId: `mess-${i}`, botId, joinedAt: new Date(1000 * (n + 1)) })))).run()
const store = createMessageStore(db)
const runtime = createChatRuntime(store)
const handle = createTurnHandler(store, runtime.runRoot)
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const free = (chatId: string) => { const release = runtime.reserveRoot(chatId); release?.(); return !!release }

// Fünf identische ältere Turns enthalten kurze Werkzeuginhalte: nur sie unterscheiden die geprüften Varianten.
for (let i = 0; i < cases.length; i++) {
  const chatId = `mess-${i}`
  const history: UIMessage<ChatMetadata>[] = Array.from({ length: 5 }, (_, j) => [
    { id: `${chatId}-u${j}`, role: "user", parts: [{ type: "text", text: `Beispiel ${j}: kurze Vorfrage.` }] },
    { id: `${chatId}-a${j}`, role: "assistant", parts: [{ type: "tool-read_coding_rules", toolCallId: `${chatId}-t${j}`, state: "output-available", input: {}, output: "ok" }, { type: "text", text: "Verstanden." }] },
  ]).flat() as UIMessage<ChatMetadata>[]
  await store.saveMessages(chatId, history)
}

const reports: unknown[] = []
for (let i = 0; i < cases.length; i++) {
  const chatId = `mess-${i}`, before = calls
  const release = runtime.reserveRoot(chatId)
  if (!release) throw new Error("Testchat bereits belegt.")
  const message: UIMessage<ChatMetadata> = { id: `${chatId}-neu`, role: "user", parts: [{ type: "text", text: cases[i]! }] }
  const started = runtime.turns.start(chatId, signal => handle({ chatId, body: { messages: [message], clientData: { model: "gemini-3.8-flash-low", modelPinned: true } }, signal }), release)
  if (!started) throw new Error("Messlauf konnte nicht gestartet werden.")
  const deadline = Date.now() + 180_000
  await delay(30)
  while (Date.now() < deadline && (runtime.turns.isRunning(chatId) || !free(chatId))) await delay(50)
  if (Date.now() >= deadline) { runtime.stopRoot(chatId); runtime.turns.stop(chatId); throw new Error("Messlauf überschritt das Zeitlimit.") }
  await delay(50)
  const all = await store.listMessages(chatId)
  const responses = all.slice(10).filter(item => item.role === "assistant").map(item => ({ botId: item.metadata?.botId ?? null, text: item.parts.flatMap(part => part.type === "text" ? [part.text] : []).join(" ") })).filter(item => item.text)
  const response = responses.map(item => item.text)
  const werkzeugErreicht = all.slice(10).some(item => item.parts.some(part => part.type === "tool-read_coding_rules" && "state" in part && part.state === "output-available"))
  const rows = sqlite.prepare("select input_tokens, output_tokens, cached_tokens, system_chars, tools_chars, volatile_chars, history_chars, tool_result_chars from turn_usage where chat_id = ? order by rowid").all(chatId) as Record<string, number | null>[]
  const sum = (key: string) => rows.length && rows.every(row => row[key] != null) ? rows.reduce((total, row) => total + row[key]!, 0) : null
  reports.push({ nr: i + 1, auftrag: cases[i], antworten: response, antwortVon: responses.map(item => item.botId), werkzeugErreicht, modellaufrufe: calls - before, strukturiertePromptZeichen: promptChars.slice(before, calls), eingabeTokens: sum("input_tokens"), ausgabeTokens: sum("output_tokens"), cacheTokens: sum("cached_tokens"), zeichen: { system: sum("system_chars"), werkzeuge: sum("tools_chars"), kontext: sum("volatile_chars"), verlauf: sum("history_chars"), werkzeugErgebnisse: sum("tool_result_chars") }, protokollzeilen: rows.length })
  if (modelFailed || !response.length || (i === 8 && !werkzeugErreicht) || (i === 9 && !responses.some(item => item.botId === "beta"))) break
  if (calls >= maxCalls && i < cases.length - 1) break
}
sqlite.close()
const complete = !modelFailed && reports.length === cases.length && (reports.at(-1) as { antwortVon: (string | null)[] }).antwortVon.includes("beta")
console.log(JSON.stringify({ modus: mock ? "attrappe" : "agy", datenordner: dataDir, aufrufe: calls, grenze: maxCalls, vollstaendig: complete, zeichenHinweis: "Turn-Log vor der letzten Verlaufskürzung; keine separaten Tokenmessungen.", faelle: reports }, null, 2))
if (!complete) process.exitCode = 1
