import assert from "node:assert/strict"
import { test } from "node:test"

import { resolveApproval } from "./rules.ts"
import { APPROVAL_LIFETIME_MS, isExpired } from "./expiry.ts"

const DAY = 24 * 60 * 60_000

const store = { create: async () => Date.now(), get: async () => Date.now() }

test("Deny blockiert auch ein freies Werkzeug vor execute", async () => {
  const { withApproval } = await import("./with-approval.ts")
  let executed = false
  const original = {
    execute: async () => {
      executed = true
      return { ok: true }
    },
  }
  const protectedTool = withApproval(original as never, {
    name: "memory_set",
    decide: () => "deny",
    userId: "u",
    store,
  }) as unknown as { execute: (i: unknown, o: { toolCallId: string }) => Promise<unknown> }
  assert.deepEqual(await protectedTool.execute({}, { toolCallId: "t" }), { error: "denied by user" })
  assert.equal(executed, false)
})

test("needsApproval entscheidet je Aufruf nach dem Befehl", async () => {
  const { withApproval } = await import("./with-approval.ts")
  let created = 0
  const protectedTool = withApproval(
    { execute: async () => ({ ok: true }) } as never,
    {
      name: "bash",
      decide: (input) => resolveApproval([], { tool: "bash", botId: "b", input }).mode,
      userId: "u",
      store: {
        create: async () => {
          created++
          return Date.now()
        },
        get: async () => Date.now(),
      },
    }
  ) as unknown as {
    needsApproval: (input: unknown, o: { toolCallId: string }) => Promise<boolean>
  }
  assert.equal(await protectedTool.needsApproval({ command: "zip -r a.zip a" }, { toolCallId: "a" }), false)
  assert.equal(created, 0)
  assert.equal(await protectedTool.needsApproval({ command: "rm a.txt" }, { toolCallId: "b" }), true)
  assert.equal(created, 1)
})

test("Freigabeanfragen bleiben je toolCallId gespeichert und laufen ab", async () => {
  const { approvalNeedsApproval, approvalExecute } =
    await import("./request.ts")
  const rows = new Map<string, number>()
  const store = {
    create: async (r: { toolCallId: string }) => {
      rows.set(r.toolCallId, rows.get(r.toolCallId) ?? 0)
      return rows.get(r.toolCallId)!
    },
    get: async (id: string) => rows.get(id) ?? null,
  }
  await approvalNeedsApproval(store, {
    required: true,
    toolCallId: "a",
    userId: "u",
    tool: "x",
  })()
  rows.set("a", 0)
  await approvalNeedsApproval(store, {
    required: true,
    toolCallId: "b",
    userId: "u",
    tool: "x",
  })()
  rows.set("b", 0)
  assert.deepEqual(
    await approvalExecute(store, "a", "u", true, DAY - 1, async () => "ok"),
    "ok"
  )
  assert.deepEqual(
    await approvalExecute(store, "a", "u", true, DAY, async () => "ok"),
    { error: "approval expired" }
  )
  assert.deepEqual(
    await approvalExecute(store, "b", "u", true, 1, async () => "ok"),
    "ok"
  )
  assert.equal(
    await approvalExecute(
      { ...store, get: async () => null },
      "inbox",
      "u",
      false,
      1,
      async () => "inbox written"
    ),
    "inbox written"
  )
})

test("Freigabe läuft erst an der 24-Stunden-Grenze ab", () => {
  assert.equal(APPROVAL_LIFETIME_MS, DAY)
  assert.equal(isExpired(0, 15 * 60_000), false)
  assert.equal(isExpired(0, DAY - 1), false)
  assert.equal(isExpired(0, DAY), true)
})

