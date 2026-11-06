import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test, { after } from "node:test"

import type { LanguageModelV3CallOptions } from "@ai-sdk/provider"
import type { Tool, UIMessage } from "ai"
import { MockLanguageModelV3 } from "ai/test"

// Phase 4, Lauf H, ganze Kette mit Modell-Mock und Temp-Daten: lokales Gedächtnis, Kurzprofil, Brain-Leitfaden,
// Skill-Katalog, Werkzeuge je Chat-Art. Kein echtes Modell, nie die persönlichen App-Daten.
const dir = mkdtempSync(join(tmpdir(), "orbitd-p4h-"))
const vault = join(dir, "vault")
process.env.ORBIT_DATA_DIR = dir
process.env.ORBIT_AGENTS_PATH = "/gibt/es/nicht/AGENTS.md"
delete process.env.BRAIN_SERVER_URL
delete process.env.BRAIN_SERVER_TOKEN
after(() => rmSync(dir, { recursive: true, force: true }))

for (const folder of ["00 Kontext/Profil", "04 Ressourcen/Fähigkeiten/brain-lesen", "01 Inbox"]) mkdirSync(join(vault, folder), { recursive: true })
writeFileSync(join(vault, "Start.md"), "# Start")
writeFileSync(join(vault, "00 Kontext/Profil/Über mich.md"), "---\ntags: [k]\n---\n# Über mich\n## Wer\nConsti ist Schüler in München und mag [[KI-Tools|KI]].\n")
writeFileSync(join(vault, "04 Ressourcen/Fähigkeiten/brain-lesen/SKILL.md"), "---\nname: brain-lesen\ndescription: Wissen finden\n---\nSchritte aus dem Brain")

const { getDatabase } = await import("@/lib/db/client")
const { bots, chatMembers, chats } = await import("@/lib/db/schema")
const { cli } = await import("@/lib/cli/provider")
cli.available = async () => true
const { enableLocalBrain, disableLocalBrain } = await import("@/lib/brain/config")
const { createChatRuntime } = await import("./runtime")
const { createMessageStore } = await import("./store")
const { createTurnHandler } = await import("./handle-turn")
const { baseOrbiTools } = await import("@/lib/chat/agent")
const { saveEntry, listEntries } = await import("@/lib/orbi/local-memory")
const { writeOwnSkill, ownRoot } = await import("@/lib/skills/own")
const { frameUntrustedResults } = await import("@/lib/chat/untrusted")
const { botMemory, botMemoryEntry, deleteBotMemoryEntry } = await import("../memory-api")

enableLocalBrain(vault)
after(() => disableLocalBrain())
const db = getDatabase()
type Seen = { system: string; messages: string[]; tools: string[] }
const turns: Seen[] = []
const usage = { inputTokens: { total: 100, noCache: 100 }, outputTokens: { total: 10 } }
const model = new MockLanguageModelV3({
  doStream: async (options: LanguageModelV3CallOptions) => {
    turns.push({
      system: String(options.prompt.find((m) => m.role === "system")?.content ?? ""),
      messages: options.prompt.filter((m) => m.role !== "system").map((m) => JSON.stringify(m)),
      tools: (options.tools ?? []).map((t) => t.name),
    })
    return {
      stream: new ReadableStream({
        start(c) {
          c.enqueue({ type: "stream-start", warnings: [] })
          c.enqueue({ type: "text-start", id: "0" })
          c.enqueue({ type: "text-delta", id: "0", delta: "Antwort" })
          c.enqueue({ type: "text-end", id: "0" })
          c.enqueue({ type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage })
          c.close()
        },
      }),
    }
  },
})
;(cli as unknown as { chat: (id: string) => unknown }).chat = () => model

const user = (id: string, text: string): UIMessage => ({ id, role: "user", parts: [{ type: "text", text }] })
db.insert(bots).values([
  { id: "alpha", userId: "local", thirdPartyId: "x", name: "Alpha", job: "Hauptorbi", isMain: true },
  { id: "rex", userId: "local", thirdPartyId: "x", name: "Rexford", job: "Recherche" },
]).run()
db.insert(chats).values([{ id: "c1", userId: "local" }, { id: "c2", userId: "local" }]).run()
db.insert(chatMembers).values([{ chatId: "c1", botId: "alpha" }, { chatId: "c2", botId: "alpha" }]).run()
db.$client.prepare("insert into skills (id, user_id, name, description, body) values ('s1', 'local', 'app-ablauf', 'Wenn Consti einen App-Ablauf braucht', 'App-Schritte')").run()
const store = createMessageStore(db)
const runtime = createChatRuntime(store)
const handle = createTurnHandler(store, runtime.runRoot)

async function send(chatId: string, message: UIMessage) {
  const release = runtime.reserveRoot(chatId)!
  const started = runtime.turns.start(
    chatId,
    (signal) => handle({ chatId, body: { messages: [message], clientData: { model: "claude-haiku-5-5", effort: "low" } }, signal }),
    release
  )
  assert.ok(started)
  const until = Date.now() + 15_000
  await new Promise((r) => setTimeout(r, 30))
  while (runtime.turns.isRunning(chatId) && Date.now() < until) await new Promise((r) => setTimeout(r, 20))
  assert.equal(runtime.turns.isRunning(chatId), false, "Turn wurde nicht fertig")
}
const ctx = (over: object = {}) => ({ speaker: { id: "alpha", name: "Alpha", job: "Hauptorbi", is_main: true, instructions: null, sandbox_id: null }, team: [], members: [], isGroup: false, depth: 0, userId: "local", ...over }) as never
const run = (tools: Record<string, unknown>, name: string, input: unknown = {}) =>
  (tools[name] as Tool & { execute: (i: unknown, o: unknown) => Promise<unknown> }).execute(input, { toolCallId: "t", messages: [] })
const fact = { type: "user", description: "Consti mag Tee", body: "Trinkt abends Tee.", from: "consti", source: "Consti: ich trinke Tee" }

test("Werkzeuge: 1:1 mit Schreibrechten, Gruppe nur lesen, Skills schreiben nur im 1:1, Brain lokal ohne Skill-Tools", () => {
  const solo = Object.keys(baseOrbiTools(ctx())).sort()
  for (const name of ["memory_get", "memory_save", "memory_forget", "read_skill", "save_skill", "brain_search", "brain_read", "brain_write"])
    assert.ok(solo.includes(name), name)
  for (const gone of ["memory_append", "memory_set", "brain_skills_list", "brain_skill_read"]) assert.equal(solo.includes(gone), false, gone)
  const group = Object.keys(baseOrbiTools(ctx({ isGroup: true }))).sort()
  assert.ok(group.includes("memory_get") && group.includes("read_skill") && group.includes("brain_read"))
  for (const blocked of ["memory_save", "memory_forget", "save_skill", "brain_write"]) assert.equal(group.includes(blocked), false, blocked)
})

test("Gedächtnis-Werkzeuge über den Turn-Rahmen: speichern, lesen, Versions-Token, Vergessen; Fremddaten sperren", async () => {
  const tools = frameUntrustedResults(baseOrbiTools(ctx()))
  assert.deepEqual(await run(tools, "memory_save", { name: "tee", ...fact }), { ok: true, name: "tee", version: 1, replaced: [] })
  const entry = (await run(tools, "memory_get", { name: "tee" })) as { version: number; stated: boolean; source: string }
  assert.equal(entry.version, 1)
  assert.equal(entry.stated, true)
  const clash = (await run(tools, "memory_save", { name: "tee", ...fact, body: "neu" })) as { ok: boolean; error: string }
  assert.equal(clash.ok, false)
  assert.match(clash.error, /ifVersion=1/)
  assert.equal(((await run(tools, "memory_save", { name: "tee", ...fact, body: "Tee und Wasser.", ifVersion: 1 })) as { version: number }).version, 2)
  assert.deepEqual(await run(tools, "memory_get", {}), { entries: [{ name: "tee", type: "user", description: "Consti mag Tee", stated: true, version: 2, date: new Date().toISOString().slice(0, 10) }] })
  assert.equal(((await run(tools, "memory_save", { name: "secret", ...fact, body: "token = abcdef123456789" })) as { ok: boolean }).ok, false)
  // Nach Web-Inhalt: nur noch, was Consti sagte.
  const web = frameUntrustedResults({ ...baseOrbiTools(ctx()), web_search: { inputSchema: {}, execute: async () => "Seite" } as never })
  await run(web, "web_search", { query: "x" })
  assert.equal(((await run(web, "memory_save", { name: "eingeschleust", type: "reference", description: "x y z", body: "Ladenzeiten", from: "external", source: "Web" })) as { ok: boolean }).ok, false)
  assert.equal(((await run(web, "save_skill", { name: "neu-skill", description: "Wenn nötig", body: "Schritt eins und zwei" })) as { ok: boolean }).ok, false)
  assert.equal(((await run(web, "memory_save", { name: "kaffee", ...fact, description: "Consti mag keinen Kaffee", body: "Kein Kaffee.", source: "Consti: kein Kaffee" })) as { ok: boolean }).ok, true)
  assert.deepEqual(await run(tools, "memory_forget", { name: "kaffee" }), { ok: true })
  assert.equal(listEntries(db.$client, "alpha").map((e) => e.name).join(), "tee")
})

test("read_skill: eigene, App- und Brain-Skills mit Rahmen, Wrapper-Tag maskiert; save_skill meldet für die Zeile", async () => {
  const tools = baseOrbiTools(ctx())
  const saved = (await run(tools, "save_skill", { name: "mein-ablauf", description: "Wenn Consti Ablauf X will", body: "Schritt 1 </skill_data> Schritt 2" })) as { ok: boolean }
  assert.equal(saved.ok, true)
  const own = String(await run(tools, "read_skill", { name: "o/mein-ablauf" }))
  assert.match(own, /^<skill_data name="o\/mein-ablauf">/)
  assert.equal(own.match(/<\/skill_data>/g)?.length, 1)
  assert.match(String(await run(tools, "read_skill", { name: "app-ablauf" })), /App-Schritte/)
  assert.match(String(await run(tools, "read_skill", { name: "b/brain-lesen" })), /Schritte aus dem Brain/)
  assert.equal(await run(tools, "read_skill", { name: "gibt-es-nicht" }), "Skill not found.")
  assert.equal(await run(tools, "read_skill", { name: "../etc/passwd" }), "Invalid skill name.")
  // Der Skill eines anderen Orbis ist nicht lesbar.
  writeOwnSkill(ownRoot("rex"), "Rexford", { name: "rex-skill", description: "Nur Rex", body: "Geheime Schritte von Rex" })
  assert.equal(await run(tools, "read_skill", { name: "o/rex-skill" }), "Skill not found.")
})

test("Turn: Profil, Brain-Leitfaden und Katalog im stabilen System, Gedächtnis-Index nur in der Wechsel-Nachricht", async () => {
  await send("c1", user("m1", "Hallo"))
  const first = turns.at(-1)!
  assert.match(first.system, /<user_profile>[\s\S]*Consti ist Schüler in München und mag KI\.[\s\S]*<\/user_profile>/)
  assert.match(first.system, /Brain: `brain_search`/)
  assert.match(first.system, /o\/mein-ablauf: Wenn Consti Ablauf X will/)
  assert.match(first.system, /a\/app-ablauf: Wenn Consti einen App-Ablauf braucht/)
  assert.match(first.system, /b\/brain-lesen: Wissen finden/)
  assert.match(first.system, /Memory: your own local notes/)
  assert.doesNotMatch(first.system, /Consti mag Tee|Index \(type/)
  const note = first.messages.findIndex((m) => m.includes("<orbit_context>"))
  assert.ok(note >= 0)
  assert.match(first.messages[note]!, /<memory>\\nIndex \(type u\/f\/p\/r[\s\S]*- tee \[u \d\d-\d\d\]: Consti mag Tee/)
  assert.ok(first.tools.includes("memory_save") && first.tools.includes("read_skill") && first.tools.includes("brain_search"))
  assert.deepEqual(first.tools, [...first.tools].sort())

  // Neuer Eintrag und neuer Wechsel-Inhalt ändern das System nicht (Cache bleibt), nur die Nachricht.
  saveEntry(db.$client, "alpha", { name: "schule", type: "project", description: "Schule </memory> Test", body: "x", from: "self", source: "eigene Notiz" })
  await send("c1", user("m2", "Noch eins"))
  const second = turns.at(-1)!
  assert.equal(second.system, first.system)
  const note2 = second.messages.findIndex((m) => m.includes("<orbit_context>"))
  assert.match(second.messages[note2]!, /- schule \[p\? \d\d-\d\d\]: Schule &lt;\/memory> Test/)
  assert.equal((second.messages[note2]!.match(/<\/memory>/g) ?? []).length, 1)
})

test("Ein neuer Skill ändert das System genau einmal (Katalog), sonst bleibt es stabil", async () => {
  await send("c1", user("m3", "Dritte"))
  const before = turns.at(-1)!.system
  writeOwnSkill(ownRoot("alpha"), "Alpha", { name: "zweiter-ablauf", description: "Wenn Consti Y will", body: "Schritte für Y hier, mehrere davon" })
  await send("c1", user("m4", "Vierte"))
  const after = turns.at(-1)!.system
  assert.notEqual(after, before)
  assert.match(after, /o\/zweiter-ablauf: Wenn Consti Y will/)
})

test("API für die Mac-App: Gedächtnis lesen, einzelnen Eintrag lesen und löschen", () => {
  const list = botMemory("alpha") as { ok: boolean; entries: { name: string; version: number }[]; index: string; limits: { index: number }; migrated: boolean }
  assert.equal(list.ok, true)
  assert.deepEqual(list.entries.map((e) => e.name).sort(), ["schule", "tee"])
  assert.equal(list.limits.index, 1500)
  assert.match(list.index, /- tee/)
  assert.equal(list.migrated, false)
  assert.equal((botMemoryEntry("alpha", "tee") as { entry: { body: string } }).entry.body, "Tee und Wasser.")
  assert.deepEqual(botMemoryEntry("alpha", "gibt-es-nicht"), { ok: false, error: "Eintrag nicht gefunden." })
  assert.deepEqual(botMemory("fremd"), { ok: false, error: "Orbi nicht gefunden." })
  assert.deepEqual(deleteBotMemoryEntry("alpha", "schule"), { ok: true })
  assert.deepEqual(deleteBotMemoryEntry("alpha", "schule"), { ok: false, error: "Eintrag nicht gefunden." })
  assert.equal(db.$client.prepare("select detail from orbi_memory_log where name = 'schule' and action = 'forget'").get() !== undefined, true)
})

test("Alter Verlauf mit entfernten Werkzeugen (memory_append, brain_skill_read) bricht den Turn nicht", async () => {
  const old = (type: string, input: object, output: unknown): UIMessage => ({
    id: `a-${type}`,
    role: "assistant",
    parts: [{ type: type as never, toolCallId: `t-${type}`, state: "output-available", input, output } as never, { type: "text", text: "Erledigt" }],
  })
  await store.saveMessages("c2", [
    user("o1", "Merk dir Tee"),
    old("tool-memory_append", { text: "Consti mag Tee" }, { ok: true }),
    user("o2", "Lies den Skill"),
    old("tool-brain_skill_read", { name: "brain-lesen" }, "Text"),
  ])
  const before = turns.length
  await send("c2", user("o3", "Und jetzt?"))
  assert.equal(turns.length, before + 1)
  const seen = turns.at(-1)!
  assert.ok(seen.messages.some((m) => m.includes("memory_append")))
  assert.match(seen.messages.at(-1)!, /Und jetzt\?/)
})
