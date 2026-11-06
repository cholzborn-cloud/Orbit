// Legt in einer Datenbankkopie den festen Testverlauf für --selftest-layout an: Orbi „Karti“ mit allen Karten (Freigabe offen, Befehl,
// Websuche, Bild, Bildfehler, Übergabe, Rückfrage beantwortet, Jev-Block). Web (measure-web.mjs) und nativ messen denselben Chat.
// Aufruf: ORBIT_DATA_DIR=<Kopie> ORBITD_URL=http://127.0.0.1:4399 node seed-layout.mjs   (Dienst mit ORBIT_FAKE_SANDBOX=1 läuft darauf)
// Gibt die Chat-ID auf stdout aus. Nur gegen eine Kopie; läuft wiederholbar (legt Karti nur an, wenn es fehlt, und ersetzt den Verlauf).
import fs from "fs"
import path from "path"
import { createRequire } from "module"
const require = createRequire(path.join(process.cwd(), "package.json"))
const Database = require("better-sqlite3")
const sharp = require("sharp")

const dir = process.env.ORBIT_DATA_DIR
if (!dir || path.resolve(dir) === path.join(process.env.HOME, "Library/Application Support/Orbit")) throw new Error("Nur gegen eine Kopie (ORBIT_DATA_DIR).")
const base = process.env.ORBITD_URL ?? "http://127.0.0.1:4399"
const token = fs.readFileSync(path.join(dir, "service.token"), "utf8").trim()
const api = async (p, init = {}) => (await fetch(base + p, { ...init, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...init.headers } })).json()

const db = new Database(path.join(dir, "orbit.sqlite"))
let bot = db.prepare("select id from bots where name = 'Karti'").get()
if (!bot) {
  const made = await api("/v1/bots", { method: "POST", body: JSON.stringify({ name: "Karti", avatar: "marsi", color: "#e8591a", isMain: false, job: "Karten-Testorbi", instructions: "" }) })
  if (!made.ok) throw new Error("Karti anlegen: " + JSON.stringify(made))
  bot = db.prepare("select id from bots where name = 'Karti'").get()
}
const chatId = db.prepare("select chat_id from chat_members where bot_id = ? and chat_id in (select id from chats where kind = 'direct')").get(bot.id).chat_id

const jpeg = await sharp({ create: { width: 420, height: 280, channels: 3, background: "#b3401c" } }).composite([{ input: Buffer.from('<svg width="420" height="280"><circle cx="210" cy="140" r="90" fill="#f2a65a"/></svg>') }]).jpeg().toBuffer()
const botId = bot.id
const jev = { kind: "route", tier: "fast", model: "claude-haiku-5-5", modelLabel: "Haiku 5.5", effort: "low", reason: "Kurze Anfrage, schnelles Modell reicht.", durationMs: 420, source: "jev" }
const meta = (extra = {}) => ({ botId, model: "Haiku 5.5", effort: "low", startedAt: 1792700000000, finishedAt: 1792700004000, inputTokens: 1200, outputTokens: 80, ...extra })
const messages = [
  ["user", [{ type: "text", text: "Zeig mir alle Karten" }]],
  ["assistant", [
    { type: "step-start" }, { type: "text", text: "Ich brauche deine Freigabe für einen Befehl; bis dahin zeige ich dir alle Karten.", state: "done" },
    { type: "tool-bash", toolCallId: "t-bash", state: "output-available", input: { command: "echo hallo" }, output: { exitCode: 0, stdout: "hallo\n", stderr: "" } },
    { type: "tool-web_search", toolCallId: "t-web", state: "output-available", input: { query: "Hono" }, output: { answer: "Hono ist ein schnelles, kleines Web-Framework für Edge-Laufzeiten.", sources: [{ title: "Hono", url: "https://hono.dev" }, { title: "Hono auf GitHub", url: "https://github.com/honojs/hono" }] } },
    { type: "tool-generate_image", toolCallId: "t-img", state: "output-available", input: { prompt: "Ein roter Planet auf dunklem Grund", size: "1536x1024" }, output: { ok: true, data: jpeg.toString("base64"), mediaType: "image/jpeg", prompt: "Ein roter Planet auf dunklem Grund", size: "1536x1024" } },
    { type: "tool-generate_image", toolCallId: "t-imgerr", state: "output-available", input: { prompt: "Noch ein Planet", size: "1024x1024" }, output: { ok: false, error: "Bildgenerierung nicht verfügbar.", prompt: "Noch ein Planet", size: "1024x1024" } },
    { type: "tool-handoff", toolCallId: "t-hand", state: "output-available", input: { target_orbi: "Zeno", reason: "Zeno kennt die Dateien.", task: "Fasse die Dateien zusammen." }, output: { to: "Zeno", avatar: "zeno", color: "#2f7fd8", task: "Fasse die Dateien zusammen.", reason: "Zeno kennt die Dateien.", message: { id: "h-1", role: "assistant", parts: [{ type: "text", text: "Zusammenfassung: drei Dateien, alle klein." }] } } },
    { type: "tool-ask_user", toolCallId: "t-ask", state: "output-available", input: { questions: [{ question: "Welche Farbe soll die Karte haben?", options: [{ label: "Blau", recommended: true }, { label: "Grün" }, { label: "Rot" }] }] }, output: { answers: [{ question: "Welche Farbe soll die Karte haben?", answers: ["Blau"] }] } },
  ], meta({ jev })],
  ["user", [{ type: "text", text: "Danke. Und jetzt der Ordner." }]],
  ["assistant", [
    { type: "step-start" },
    { type: "tool-bash", toolCallId: "t-appr", state: "approval-requested", input: { command: "ls -la ~/Dokumente", apiKey: "geheim-123" }, approval: { id: "seed-appr-1" } },
  ], meta()],
]
db.transaction(() => {
  db.prepare("delete from chat_messages where chat_id = ?").run(chatId)
  const insert = db.prepare("insert into chat_messages (chat_id, id, role, parts, metadata, position) values (?, ?, ?, ?, ?, ?)")
  messages.forEach(([role, parts, metadata], i) => insert.run(chatId, `seed-${i}`, role, JSON.stringify(parts), metadata ? JSON.stringify(metadata) : null, i))
  db.prepare("update chats set last_message_at = ? where id = ?").run(Date.now(), chatId)
})()
console.log(chatId)
