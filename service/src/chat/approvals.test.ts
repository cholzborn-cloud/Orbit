import assert from "node:assert/strict"
import test from "node:test"
import { tool } from "ai"
import { z } from "zod"

import { withApproval } from "../../../lib/approvals/with-approval.ts"
import { confirmActionTool } from "../../../lib/chat/confirm-action.ts"

const original = tool({
  inputSchema: z.object({ path: z.string() }),
  execute: async () => ({ executed: true }),
})
const options = { toolCallId: "call", messages: [] }
async function final(value: unknown): Promise<unknown> {
  const result = await value
  if (result && typeof result === "object" && Symbol.asyncIterator in result) {
    let last: unknown
    for await (const output of result as AsyncIterable<unknown>) last = output
    return last
  }
  return result
}

test("Injizierter Wait-Adapter führt erst nach Freigabe aus und wahrt Ablauf", async () => {
  let approved = false
  let requestedAt = Date.now()
  const wrapped = withApproval(original, {
    name: "write",
    decide: () => "ask",
    userId: "local",
    store: { create: async () => requestedAt, get: async () => requestedAt },
    waitForApproval: async () => approved,
  })
  assert.equal(wrapped.needsApproval, false)
  assert.deepEqual(await final(wrapped.execute!({ path: "file" }, options)), {
    error: "Freigabe abgelehnt, abgelaufen oder abgebrochen.",
  })
  approved = true
  assert.deepEqual(await final(wrapped.execute!({ path: "file" }, options)), {
    executed: true,
  })
  requestedAt -= 24 * 60 * 60_000
  assert.deepEqual(await final(wrapped.execute!({ path: "file" }, options)), {
    error: "approval expired",
  })
})

test("Freie Aufrufe warten nie; deny wird vom Wait-Adapter nie übergangen", async () => {
  let waits = 0
  const config = {
    userId: "local",
    store: { create: async () => Date.now(), get: async () => Date.now() },
    waitForApproval: async () => {
      waits++
      return true
    },
  }
  const free = withApproval(original, { ...config, name: "brain_write", decide: () => "allow" })
  assert.deepEqual(await final(free.execute!({ path: "02 Projekte/Notiz.md" }, options)), { executed: true })
  assert.equal(waits, 0)
  const denied = withApproval(original, { ...config, name: "write", decide: () => "deny" })
  assert.deepEqual(await final(denied.execute!({ path: "file" }, options)), { error: "denied by user" })
  assert.equal(waits, 0)
})

test("Geschützter Generator behält live Zwischenergebnisse in Reihenfolge", async () => {
  let approve!: () => void
  const approval = new Promise<boolean>((resolve) => {
    approve = () => resolve(true)
  })
  let continueRun!: () => void
  const continued = new Promise<void>((resolve) => {
    continueRun = resolve
  })
  const streaming = tool({
    inputSchema: z.object({ path: z.string() }),
    execute: async function* () {
      yield { status: "running" }
      await continued
      yield { status: "finished" }
    },
  })
  const wrapped = withApproval(streaming, {
    name: "handoff",
    decide: () => "ask",
    userId: "local",
    store: { create: async () => Date.now(), get: async () => Date.now() },
    waitForApproval: () => approval,
  })
  const output = wrapped.execute!({ path: "file" }, options) as AsyncIterable<{
    status: string
  }>
  assert.equal(typeof output[Symbol.asyncIterator], "function")
  const reader = output[Symbol.asyncIterator]()
  const first = reader.next()
  approve()
  assert.deepEqual(await first, { value: { status: "running" }, done: false })
  const second = reader.next()
  continueRun()
  assert.deepEqual(await second, { value: { status: "finished" }, done: false })
  assert.equal((await reader.next()).done, true)
})


test("confirm_action liefert approved true nach Freigabe, sonst approved false", async () => {
  let approved = false
  const wrapped = withApproval(confirmActionTool(), {
    name: "confirm_action",
    decide: () => "ask",
    userId: "local",
    deniedOutput: { approved: false },
    store: { create: async () => Date.now(), get: async () => Date.now() },
    waitForApproval: async () => approved,
  })
  const input = { reason: "geld" as const, summary: "Kauft das Buch" }
  assert.deepEqual(await final(wrapped.execute!(input, options)), { approved: false })
  approved = true
  assert.deepEqual(await final(wrapped.execute!(input, { ...options, toolCallId: "zwei" })), { approved: true })
})

test("protectTools: Dateien ohne Karte, Senden genau eine Karte, nach Immer keine mehr", async () => {
  const { protectTools } = await import("./approvals.ts")
  const { InteractionManager } = await import("../interactions.ts")
  const saved: { tool: string; approvalKind?: string; reason?: string; text?: string }[] = []
  const store = { create: async () => Date.now(), get: async () => Date.now() }
  const manager = new InteractionManager({
    store,
    saveRule: async (request) => {
      saved.push(request)
    },
  })
  const cards: { tool: string; approvalKind?: string; reason?: string; text?: string; kind: string }[] = []
  let calls = 0
  const run = tool({ inputSchema: z.object({}).passthrough(), execute: async () => ({ ran: ++calls }) })
  const tools = protectTools(
    { share_file: run, connector_mail__send_message: run },
    {
      chatId: "c",
      ctx: { speaker: { id: "b" } } as never,
      rules: [],
      lastUserText: "Fass die Datei zusammen",
      manager,
      store,
      signal: new AbortController().signal,
      onApproval: async (request) => {
        cards.push(request)
        await manager.decide(request.id, { approved: true, always: true })
      },
      onDecision: () => {},
    }
  )
  assert.deepEqual(await final(tools.share_file!.execute!({ path: "output/a.zip" }, { ...options, toolCallId: "s" })), { ran: 1 })
  assert.equal(cards.length, 0)
  const send = tools.connector_mail__send_message!
  assert.deepEqual(await final(send.execute!({ to: "anna@example.org" }, { ...options, toolCallId: "m1" })), { ran: 2 })
  assert.equal(cards.length, 1)
  assert.equal(cards[0]!.kind, "approval")
  assert.equal(cards[0]!.tool, "connector:mail:send_message")
  assert.equal(cards[0]!.approvalKind, "connector:mail:send_message")
  assert.equal(cards[0]!.reason, "nachricht")
  assert.match(cards[0]!.text ?? "", /Sendet eine Nachricht in deinem Namen an anna@example\.org/)
  assert.equal(saved[0]!.approvalKind, "connector:mail:send_message")
  assert.deepEqual(await final(send.execute!({ to: "anna@example.org" }, { ...options, toolCallId: "m2" })), { ran: 3 })
  assert.equal(cards.length, 1)
})

test("protectTools: consti_said ohne Karte und nie beim Original, Zugangsdaten ohne Immer", async () => {
  const { protectTools } = await import("./approvals.ts")
  const { InteractionManager } = await import("../interactions.ts")
  const store = { create: async () => Date.now(), get: async () => Date.now() }
  let saves = 0
  const manager = new InteractionManager({ store, saveRule: async () => void saves++ })
  let cards = 0
  const seen: unknown[] = []
  const run = tool({ inputSchema: z.object({ command: z.string() }), execute: async (input) => (seen.push(input), { ok: true }) })
  const make = (lastUserText?: string) =>
    protectTools(
      { bash: run },
      {
        chatId: "c",
        ctx: { speaker: { id: "b" } } as never,
        rules: [],
        lastUserText,
        manager,
        store,
        signal: new AbortController().signal,
        onApproval: async (request) => {
          cards++
          await manager.decide(request.id, { approved: true, always: true })
        },
        onDecision: () => {},
      }
    ).bash!
  const bash = make("Lösch test/a.txt endgültig")
  const schema = await (bash.inputSchema as { jsonSchema: { properties: Record<string, unknown> } }).jsonSchema
  assert.ok(schema.properties.consti_said)
  const said = { command: "rm test/a.txt", consti_said: "Lösch test/a.txt endgültig" }
  assert.deepEqual(await final(bash.execute!(said, { ...options, toolCallId: "r1" })), { ok: true })
  assert.equal(cards, 0)
  assert.deepEqual(seen.at(-1), { command: "rm test/a.txt" })
  // Übergabe/Automation: kein Nutzertext, also Karte.
  assert.deepEqual(await final(make(undefined).execute!(said, { ...options, toolCallId: "r2" })), { ok: true })
  assert.equal(cards, 1)
  // Zugangsdaten: „Immer“ der alten App gilt nur einmal und wird nicht gespeichert.
  const secret = make("Fass zusammen")
  await final(secret.execute!({ command: "cat secrets.env" }, { ...options, toolCallId: "g1" }))
  await final(secret.execute!({ command: "cat secrets.env" }, { ...options, toolCallId: "g2" }))
  assert.equal(cards, 3)
  assert.equal(saves, 1)
})
