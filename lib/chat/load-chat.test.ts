// Start: node --test lib/chat/load-chat.test.ts
import assert from "node:assert/strict"
import { test } from "node:test"

import {
  defaultSql,
  handoffChatId,
  loadChat,
  loadTurn,
  turnContext,
} from "./load-chat.ts"

// Feste Uhr: loadTurn teilt den Stand nur innerhalb von 2 s.
let now = 1_000_000
Date.now = () => now
const tick = (ms: number) => (now += ms)

type Db = {
  chats: Record<string, { kind: string; user_id: string; name: string | null }>
  bots: { id: string; user_id: string; name: string }[] // Reihenfolge = Reihenfolge der Abfrage
  members: Record<string, string[]> // chatId -> botIds
}

// Attrappe für die drei Abfragen von loadChat; zählt die Aufrufe.
function fakeSql(db: Db) {
  const calls: string[] = []
  const sql = async (strings: TemplateStringsArray, ...v: unknown[]) => {
    const q = strings.join("?")
    calls.push(q)
    if (q.includes("from chats where id")) {
      const row = db.chats[v[0] as string]
      return row ? [row] : []
    }
    if (q.includes("select user_id from bots")) {
      const bot = db.bots.find((b) => b.id === v[0])
      return bot ? [{ user_id: bot.user_id }] : []
    }
    if (q.includes("from bots b left join chat_members")) {
      return db.bots
        .filter((b) => b.user_id === v[1])
        .map((b) => ({
          ...b,
          job: "Helfer",
          instructions: null,
          is_main: false,
          sandbox_id: null,
          avatar: "",
          color: null,
          member: !!db.members[v[0] as string]?.includes(b.id),
          direct_chat_id: null,
        }))
    }
    throw new Error(`unerwartete Abfrage: ${q}`)
  }
  return Object.assign(sql, { calls })
}

const base = (): Db => ({
  chats: {
    direct: { kind: "direct", user_id: "u1", name: null },
    group: { kind: "group", user_id: "u1", name: "Team" },
    empty: { kind: "group", user_id: "u1", name: "Leer" },
  },
  bots: [
    { id: "a", user_id: "u1", name: "Anna" },
    { id: "b", user_id: "u1", name: "Ben" },
    { id: "c", user_id: "u1", name: "Cem" },
    { id: "x", user_id: "u2", name: "Fremd" },
  ],
  members: { direct: ["a"], group: ["b", "c"], empty: [] },
})

const model = { model: "m" }

test("lokale SQL-Verbindung braucht keine Cloud-Konfiguration", () => {
  assert.equal(typeof defaultSql(), "function")
})

test("Chat nicht gefunden", async () => {
  await assert.rejects(
    loadChat("weg", { ...model, botId: "a" }, fakeSql(base())),
    /Chat nicht gefunden/
  )
})

test("Übergabe-Session: Orbi unbekannt", async () => {
  await assert.rejects(
    loadChat(
      handoffChatId(),
      { ...model, botId: "nix", ownerId: "u1" },
      fakeSql(base())
    ),
    /Orbi nicht gefunden/
  )
})

test("Übergabe-Session: fremder Orbi oder fehlende Nutzer-ID", async () => {
  const sql = fakeSql(base())
  await assert.rejects(
    loadChat(handoffChatId(), { ...model, botId: "x", ownerId: "u1" }, sql),
    /nicht zu diesem Konto/
  )
  await assert.rejects(
    loadChat(handoffChatId(), { ...model, botId: "a" }, sql),
    /nicht zu diesem Konto/
  )
})

test("gelöschter Chat: botId aus dem Browser bestimmt nicht den Besitzer", async () => {
  await assert.rejects(
    loadChat("weg", { ...model, botId: "x", ownerId: "u2" }, fakeSql(base())),
    /Chat nicht gefunden/
  )
})

test("Chat eines anderen Nutzers", async () => {
  await assert.rejects(
    loadChat("direct", { ...model, ownerId: "u2" }, fakeSql(base())),
    /nicht zu diesem Konto/
  )
})

test("Gruppe ohne Mitglied", async () => {
  await assert.rejects(
    loadChat("empty", model, fakeSql(base())),
    /kein Orbi Mitglied/
  )
})

test("Direktchat: Mitglied spricht, nur eigene Orbis im Team", async () => {
  const ctx = await loadChat(
    "direct",
    { ...model, botId: "a" },
    fakeSql(base())
  )
  assert.equal(ctx.speaker.id, "a")
  assert.equal(ctx.userId, "u1")
  assert.equal(ctx.isGroup, false)
  assert.equal(ctx.hidden, false)
  assert.deepEqual(
    ctx.team.map((b) => b.id),
    ["a", "b", "c"]
  )
})

test("Gruppe: gewählter Orbi, sonst erstes Mitglied", async () => {
  const sql = fakeSql(base())
  const picked = await loadChat("group", { ...model, botId: "c" }, sql)
  assert.equal(picked.speaker.id, "c")
  assert.equal(picked.isGroup, true)
  assert.equal(picked.chatName, "Team")
  assert.equal((await loadChat("group", model, sql)).speaker.id, "b")
  // Kein Mitglied gewählt (z. B. entfernt): erstes Mitglied statt Fehler.
  assert.equal(
    (await loadChat("group", { ...model, botId: "a" }, sql)).speaker.id,
    "b"
  )
})

test("Übergabe-Session: nur das Ziel spricht, unsichtbar", async () => {
  const ctx = await loadChat(
    handoffChatId(),
    { ...model, botId: "b", ownerId: "u1", handoffFrom: "a", handoffDepth: 1 },
    fakeSql(base())
  )
  assert.equal(ctx.speaker.id, "b")
  assert.equal(ctx.hidden, true)
  assert.equal(ctx.isGroup, false)
  assert.equal(ctx.from?.id, "a")
  assert.equal(ctx.depth, 1)
  assert.equal(ctx.team.length, 3)
})

test("Turn: run nutzt den Stand aus tools ohne neue Abfrage", async () => {
  tick(10_000)
  const sql = fakeSql(base())
  const cd = { ...model, botId: "a" }
  const tools = await loadTurn(
    "direct",
    cd,
    (ctx) => ({ who: ctx.speaker.id }),
    sql
  )
  const queries = sql.calls.length
  const ctx = await turnContext(tools, "direct", cd, sql)
  assert.equal(ctx.speaker.id, "a")
  assert.equal(sql.calls.length, queries)
})

test("Turn: Fortsetzungs-Start und Turn teilen sich eine Ladung", async () => {
  tick(10_000)
  const sql = fakeSql(base())
  const cd = { ...model, botId: "a" }
  const boot = await loadTurn("direct", cd, () => ({}), sql)
  const queries = sql.calls.length
  tick(500)
  const turn = await loadTurn("direct", cd, () => ({}), sql)
  assert.equal(sql.calls.length, queries)
  assert.notEqual(boot, turn) // eigenes Tool-Objekt je Aufruf
  assert.equal(
    await turnContext(turn, "direct", cd, sql),
    await turnContext(boot, "direct", cd, sql)
  )
})

test("Turn: nach 2 s oder mit anderen clientData wird neu geladen", async () => {
  tick(10_000)
  const db = base()
  const sql = fakeSql(db)
  const cd = { ...model, botId: "a" }
  const name = async (data: typeof cd & { effort?: string }) =>
    (
      await turnContext(
        await loadTurn("direct", data, () => ({}), sql),
        "direct",
        data,
        sql
      )
    ).speaker.name
  assert.equal(await name(cd), "Anna")
  db.bots[0].name = "Anni"
  tick(500)
  assert.equal(await name(cd), "Anna") // noch derselbe Turn
  assert.equal(await name({ ...cd, effort: "high" }), "Anni") // anderer Aufruf
  tick(2_100)
  db.bots[0].name = "Annika"
  assert.equal(await name(cd), "Annika") // nächster Turn
})

test("Turn: Fehler in tools wird in run geworfen und nicht geteilt", async () => {
  tick(10_000)
  const db = base()
  const sql = fakeSql(db)
  const tools = await loadTurn("neu", model, () => ({ x: 1 }), sql)
  assert.deepEqual(tools, {})
  await assert.rejects(
    turnContext(tools, "neu", model, sql),
    /Chat nicht gefunden/
  )
  db.chats.neu = { kind: "group", user_id: "u1", name: "Neu" }
  db.members.neu = ["a"]
  const retry = await loadTurn("neu", model, () => ({ x: 1 }), sql)
  assert.deepEqual(retry, { x: 1 })
})

test("Turn: unbekanntes Tool-Objekt lädt selbst", async () => {
  const ctx = await turnContext(
    {},
    "direct",
    { ...model, botId: "a" },
    fakeSql(base())
  )
  assert.equal(ctx.speaker.id, "a")
})

test("Übergabe-Ids sind eindeutig und erkennbar", () => {
  const a = handoffChatId()
  assert.match(a, /^handoff-/)
  assert.notEqual(a, handoffChatId())
})
