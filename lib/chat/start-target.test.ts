// Start: node --test lib/chat/start-target.test.ts
import assert from "node:assert/strict"
import { test } from "node:test"

import { pickStartChat, type StartChat } from "./start-target.ts"

const chat = (id: string, day: number, memberCount = 1): StartChat => ({
  id,
  lastMessageAt: new Date(2026, 9, day),
  memberCount,
})

const chats = [chat("alt", 1), chat("neu", 9), chat("gruppe", 5, 3)]

test("gültiges Cookie gewinnt, auch gegen einen neueren Chat", () => {
  assert.equal(pickStartChat(chats, "alt"), "alt")
})

test("Gruppenchat ist ein gültiges Ziel", () => {
  assert.equal(pickStartChat(chats, "gruppe"), "gruppe")
})

test("fremdes oder unbekanntes Cookie: Chat mit neuester Nachricht", () => {
  assert.equal(pickStartChat(chats, "fremd"), "neu")
})

test("fehlendes Cookie: Chat mit neuester Nachricht", () => {
  assert.equal(pickStartChat(chats, undefined), "neu")
})

test("Chat ohne Mitglied ist weder Cookie- noch Fallback-Ziel", () => {
  const leer = [chat("leer", 20, 0), chat("ok", 2)]
  assert.equal(pickStartChat(leer, "leer"), "ok")
  assert.equal(pickStartChat(leer, undefined), "ok")
})

test("keine Chats oder nur leere: kein Ziel", () => {
  assert.equal(pickStartChat([], "alt"), null)
  assert.equal(pickStartChat([chat("leer", 1, 0)], undefined), null)
})
