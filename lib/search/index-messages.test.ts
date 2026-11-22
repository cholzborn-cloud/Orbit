import assert from "node:assert/strict"
import test from "node:test"

import {
  messagesToRows,
  searchQuerySchema,
  snippetParts,
} from "./index-messages.ts"

test("indiziert nur Text aus Nutzer- und Orbi-Nachrichten", () => {
  const rows = messagesToRows({
    userId: "u",
    chatId: "c",
    fallbackTime: new Date("2026-10-01T00:00:00.000Z"),
    messages: [
      {
        id: "1",
        role: "assistant",
        metadata: { startedAt: "2026-10-01T00:00:00.000Z" },
        parts: [
          {
            type: "text",
            text: "[Luna]: Hallo\nWelt\n```options\nJa\nNein\n```",
          },
        ],
      },
      {
        id: "2",
        role: "user",
        metadata: { startedAt: "2026-10-02T00:00:00.000Z" },
        parts: [
          { type: "text", text: "Frage" },
          { type: "file", mediaType: "text/plain", url: "x" },
        ],
      },
      { id: "3", role: "system", parts: [{ type: "text", text: "intern" }] },
      {
        id: "4",
        role: "assistant",
        parts: [
          { type: "tool-test", state: "output-available", output: "tool" },
        ],
      },
    ],
  } as never)
  assert.deepEqual(rows, [
    {
      id: "c:1",
      userId: "u",
      chatId: "c",
      role: "assistant",
      body: "Hallo\nWelt",
      createdAt: new Date("2026-10-01T00:00:00.000Z"),
    },
    {
      id: "c:2",
      userId: "u",
      chatId: "c",
      role: "user",
      body: "Frage",
      createdAt: new Date("2026-10-02T00:00:00.000Z"),
    },
  ])
})

test("kürzt Nachrichtentexte auf 20000 Zeichen", () => {
  const [row] = messagesToRows({
    userId: "u",
    chatId: "c",
    fallbackTime: new Date("2026-10-01T00:00:00.000Z"),
    messages: [
      {
        id: "1",
        role: "user",
        parts: [{ type: "text", text: "x".repeat(20001) }],
      },
    ],
  } as never)
  assert.equal(row.body.length, 20000)
})

test("verwendet für Nachrichten ohne Zeitmetadaten die belegbare Chat-Zeit", () => {
  const fallbackTime = new Date("2026-09-15T12:30:00.000Z")
  const [row] = messagesToRows({
    userId: "u",
    chatId: "c",
    fallbackTime,
    messages: [
      {
        id: "old-message",
        role: "user",
        parts: [{ type: "text", text: "Frage" }],
      },
    ],
  } as never)
  assert.equal(row.createdAt, fallbackTime)
})

test("Snippet-Marker werden sicher in Textsegmente zerlegt", () => {
  assert.deepEqual(snippetParts("Vor <<Treffer>> nach"), [
    { text: "Vor ", marked: false },
    { text: "Treffer", marked: true },
    { text: " nach", marked: false },
  ])
  assert.deepEqual(snippetParts("Ohne Marker"), [
    { text: "Ohne Marker", marked: false },
  ])
})

test("Suchanfragen sind nicht leer und höchstens 200 Zeichen lang", () => {
  assert.equal(searchQuerySchema.safeParse("   ").success, false)
  assert.equal(searchQuerySchema.safeParse("A").success, true)
  assert.equal(searchQuerySchema.safeParse("x".repeat(201)).success, false)
})
