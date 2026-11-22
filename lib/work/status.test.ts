import "../../service/src/chat/fixtures/temp-data.ts"

import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, test } from "node:test"

import { openDatabase } from "../db/client.ts"
import { finishRun, interruptStale, setRunStatus, startRun } from "./runs.ts"
import { sidebarStatus } from "./status.ts"
import { markSeen, saveInteraction } from "./store.ts"

const dir = mkdtempSync(join(tmpdir(), "orbit-status-"))
after(() => rmSync(dir, { recursive: true, force: true }))
const db = openDatabase(join(dir, "t.sqlite")).$client
// created = 500: ein Chat mit Nachricht nach der Anlage; ohne Nachricht ist last_message_at == created_at.
const chat = (id: string, at: number, withMessage = true) =>
  db.prepare("insert into chats (id, user_id, kind, last_message_at, created_at) values (?, 'local', 'direct', ?, ?)").run(id, at, withMessage ? 500 : at)

test("Seitenleiste: arbeitet, braucht dich, neu, unterbrochen", () => {
  for (const id of ["w", "a", "n", "s", "i", "x"]) chat(id, 1000)
  markSeen(db, "s", 2000) // gesehen nach der letzten Nachricht
  markSeen(db, "w", 2000)
  markSeen(db, "a", 2000)
  markSeen(db, "i", 2000)
  markSeen(db, "x", 2000)
  startRun(db, { kind: "turn", chatId: "w" }, 1500)
  const waiting = startRun(db, { kind: "turn", chatId: "a" }, 1500)
  setRunStatus(db, waiting, "waiting")
  const gone = startRun(db, { kind: "turn", chatId: "i" }, 1500)
  void gone
  const status = sidebarStatus(db, 3000)
  const by = Object.fromEntries(status.chats.map((item) => [item.chatId, item]))
  assert.equal(by.w?.working, true)
  assert.equal(by.a?.needsYou, true)
  assert.equal(by.a?.working, false)
  assert.equal(by.n?.isNew, true)
  assert.equal(by.s, undefined)
  assert.equal(status.needsYou, 1)

  // Übergabe: B arbeitet im eigenen Chat, Consti schrieb in A. Nach dem Neustart zeigt A „unterbrochen“, B nicht.
  chat("root", 1000)
  markSeen(db, "root", 2000)
  const rootTurn = startRun(db, { kind: "turn", chatId: "root", botId: "ba", payload: { taskId: "T" } }, 1500)
  finishRun(db, rootTurn, "done", undefined, 1600)
  startRun(db, { kind: "handoff", chatId: "b-chat", botId: "bb", payload: { taskId: "T", rootChatId: "root" } }, 1700)

  // Neustart: aus „arbeitet“ wird „unterbrochen“, ohne dass ein Job aktiv wäre.
  interruptStale(db, 3500)
  const after = Object.fromEntries(sidebarStatus(db, 4000).chats.map((item) => [item.chatId, item]))
  assert.equal(after.w?.interrupted, true)
  assert.equal(after.w?.working, false)
  assert.equal(after.root?.interrupted, true)
  assert.equal(after["b-chat"]?.interrupted ?? false, false)
})

test("Offene Freigabe zählt als „braucht dich“, abgelaufene nicht; fertige Jobs und Chats ohne Nachricht nicht", () => {
  chat("p", 1000)
  markSeen(db, "p", 2000)
  chat("empty", 5000, false)
  saveInteraction(db, { id: "i1", chatId: "p", botId: "b", kind: "approval", requestedAt: 1, expiresAt: 10_000, request: {} })
  saveInteraction(db, { id: "i2", chatId: "x", botId: "b", kind: "approval", requestedAt: 1, expiresAt: 100, request: {} })
  const done = startRun(db, { kind: "turn", chatId: "x" }, 6000)
  finishRun(db, done, "done", undefined, 6100)
  const status = sidebarStatus(db, 5000)
  assert.equal(status.chats.find((item) => item.chatId === "p")?.needsYou, true)
  assert.equal(status.chats.find((item) => item.chatId === "x")?.needsYou ?? false, false)
  assert.equal(status.chats.find((item) => item.chatId === "empty"), undefined)
})
