import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, test } from "node:test"

const dir = mkdtempSync(join(tmpdir(), "orbitd-tasks-api-"))
process.env.ORBIT_DATA_DIR = dir

const { createApp } = await import("./app.ts")
const { registerApiRoutes } = await import("./routes.ts")
const { oauthCallback } = await import("./oauth-callback.ts")
const { getDatabase } = await import("../../lib/db/client.ts")
const { createTask } = await import("../../lib/work/tasks.ts")

const db = getDatabase().$client

// Initialdaten in bots und chats anlegen für Foreign Keys
db.prepare(
  `INSERT INTO bots (id, user_id, third_party_id, name, avatar, job)
   VALUES ('test-bot-1', 'local', 'tp-1', 'Freddy', 'bot', 'Assistant'),
          ('test-bot-2', 'local', 'tp-2', 'Rex', 'bot', 'Researcher')`
).run()

db.prepare(
  `INSERT INTO chats (id, user_id, kind, name)
   VALUES ('chat-http-1', 'local', 'direct', 'Chat 1'),
          ('chat-http-todo', 'local', 'direct', 'Todo Chat')`
).run()

db.prepare(
  `INSERT INTO chat_members (chat_id, bot_id)
   VALUES ('chat-http-1', 'test-bot-1')`
).run()

after(() => {
  try {
    getDatabase().close()
  } catch {}
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {}
})

const app = createApp({
  token: "test-token",
  port: 4319,
  store: {
    ownsChat: async () => true,
    listMessages: async () => [],
    clearMessages: async () => {},
  },
  runTurn: async () => new Response(null),
  routes: (hono) =>
    registerApiRoutes(hono, {
      start: () => ({ runId: "dummy-run", done: Promise.resolve() }),
    }),
  oauthCallback,
})

const request = (path: string, init: RequestInit = {}) =>
  app.request(`http://127.0.0.1:4319${path}`, {
    ...init,
    headers: {
      host: "127.0.0.1:4319",
      authorization: "Bearer test-token",
      ...init.headers,
    },
  })

const jsonReq = (path: string, method: string, body?: unknown) =>
  request(path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

test("HTTP: Tasks CRUD, Active-Liste und Stopp-Endpunkte", async () => {
  // 1. Task in DB speichern
  const created = createTask(db, {
    orbiId: "test-bot-1",
    parentChatId: "chat-http-1",
    title: "Web-Suche nach APIs",
    brief: "Recherche durchführen",
    status: "running",
  })

  // 2. GET /v1/tasks
  const resList = await request("/v1/tasks?chatId=chat-http-1")
  assert.equal(resList.status, 200)
  const listBody = (await resList.json()) as { tasks: Array<{ id: string; title: string }> }
  assert.ok(listBody.tasks.length >= 1)
  assert.equal(listBody.tasks[0]?.id, created.id)

  // 3. GET /v1/tasks/active
  const resActive = await request("/v1/tasks/active?chatId=chat-http-1")
  assert.equal(resActive.status, 200)
  const activeBody = (await resActive.json()) as { active: Array<{ id: string; status: string }> }
  assert.ok(activeBody.active.some((t) => t.id === created.id && t.status === "running"))

  // 4. GET /v1/tasks/:id
  const resGet = await request(`/v1/tasks/${created.id}`)
  assert.equal(resGet.status, 200)
  const getBody = (await resGet.json()) as { task: { id: string; orbiId: string } }
  assert.equal(getBody.task.orbiId, "test-bot-1")

  // 5. POST /v1/tasks/:id/stop
  const resStop = await jsonReq(`/v1/tasks/${created.id}/stop`, "POST", { reason: "User requested abort" })
  assert.equal(resStop.status, 200)
  const stopBody = (await resStop.json()) as { stopped: boolean; status: string }
  assert.equal(stopBody.stopped, true)
  assert.equal(stopBody.status, "stopped")

  // Prüfen, dass Task jetzt gestoppt ist
  const resGetStopped = await request(`/v1/tasks/${created.id}`)
  const stoppedBody = (await resGetStopped.json()) as { task: { status: string } }
  assert.equal(stoppedBody.task.status, "stopped")

  // 6. POST /v1/tasks/stop (alle)
  const resStopAll = await jsonReq("/v1/tasks/stop", "POST", { all: true, chatId: "chat-http-1" })
  assert.equal(resStopAll.status, 200)
})

test("HTTP: Stopp geht über den Executor (bricht laufende Helfer ab)", async () => {
  const calls: unknown[] = []
  const withExecutor = createApp({
    token: "test-token",
    port: 4319,
    store: { ownsChat: async () => true, listMessages: async () => [], clearMessages: async () => {} },
    runTurn: async () => new Response(null),
    routes: (hono) =>
      registerApiRoutes(
        hono,
        { start: () => ({ runId: "dummy-run", done: Promise.resolve() }) },
        async (input) => {
          calls.push(input)
          return { stoppedIds: input.taskId ? [input.taskId] : ["a", "b"] }
        }
      ),
    oauthCallback,
  })
  const post = (path: string, body: unknown) =>
    withExecutor.request(`http://127.0.0.1:4319${path}`, {
      method: "POST",
      headers: { host: "127.0.0.1:4319", authorization: "Bearer test-token", "content-type": "application/json" },
      body: JSON.stringify(body),
    })

  const one = (await (await post("/v1/tasks/t-1/stop", {})).json()) as { stopped: boolean; taskId: string }
  assert.deepEqual(one, { ok: true, taskId: "t-1", stopped: true, status: "stopped" })
  const all = (await (await post("/v1/tasks/stop", { all: true, chatId: "chat-http-1" })).json()) as { stoppedCount: number }
  assert.equal(all.stoppedCount, 2)
  assert.deepEqual(calls, [{ taskId: "t-1" }, { all: true, orbiId: undefined, chatId: "chat-http-1" }])
})

test("HTTP: Todos Endpunkte", async () => {
  // 1. POST /v1/todos/:chatId
  const writeRes = await jsonReq("/v1/todos/chat-http-todo", "POST", {
    botId: "test-bot-1",
    todos: [
      { content: "Schritt 1", status: "done" },
      { content: "Schritt 2", status: "todo" },
    ],
  })
  assert.equal(writeRes.status, 200)
  const writeBody = (await writeRes.json()) as { count: number; todos: Array<{ content: string; status: string }> }
  assert.equal(writeBody.count, 2)

  // 2. GET /v1/todos/:chatId
  const getRes = await request("/v1/todos/chat-http-todo")
  assert.equal(getRes.status, 200)
  const getBody = (await getRes.json()) as { todos: Array<{ content: string; status: string }> }
  assert.equal(getBody.todos.length, 2)

  // 3. DELETE /v1/todos/:chatId/completed (abgeschlossene löschen)
  const clearRes = await request("/v1/todos/chat-http-todo/completed", { method: "DELETE" })
  assert.equal(clearRes.status, 200)
  const clearBody = (await clearRes.json()) as { ok: boolean; cleared: number }
  assert.equal(clearBody.cleared, 1)

  // Nach Clear sollte nur noch 1 Todo da sein
  const getAfterClear = await request("/v1/todos/chat-http-todo")
  const afterBody = (await getAfterClear.json()) as { todos: Array<{ content: string; status: string }> }
  assert.equal(afterBody.todos.length, 1)
  assert.equal(afterBody.todos[0]?.content, "Schritt 2")
})

test("HTTP: Skill-Proposals, Prompt-Preview und Undo", async () => {
  // 1. Skill Proposal anlegen per POST /v1/skills/proposals
  const resCreateProp = await jsonReq("/v1/skills/proposals", "POST", {
    name: "pdf-export",
    description: "Exportiert Tabellen als PDF",
    body: "console.log('pdf export')",
    reason: "Benutzer wollte PDF Export",
    sourceChats: ["chat-http-1"],
  })
  assert.equal(resCreateProp.status, 200)
  const createdPropBody = (await resCreateProp.json()) as { ok: boolean; id: string }
  const propId = createdPropBody.id
  assert.ok(propId)

  // GET /v1/skills/proposals
  const resProps = await request("/v1/skills/proposals")
  assert.equal(resProps.status, 200)
  const propsBody = (await resProps.json()) as { proposals: Array<{ id: string; name: string }> }
  assert.ok(propsBody.proposals.some((p) => p.id === propId))

  // POST /v1/skills/proposals/:id/accept
  const resAccept = await jsonReq(`/v1/skills/proposals/${propId}/accept`, "POST", {})
  assert.equal(resAccept.status, 200)
  const acceptBody = (await resAccept.json()) as { ok: boolean; skillId: string }
  assert.equal(acceptBody.ok, true)
  assert.ok(acceptBody.skillId)

  // Zweites Proposal anlegen und ablehnen per POST /v1/skills/proposals/:id/reject
  const resCreateProp2 = await jsonReq("/v1/skills/proposals", "POST", {
    name: "unneeded-skill",
    description: "Wird abgelehnt",
    body: "console.log('unneeded')",
  })
  const prop2Id = ((await resCreateProp2.json()) as { id: string }).id
  const resReject = await jsonReq(`/v1/skills/proposals/${prop2Id}/reject`, "POST", {})
  assert.equal(resReject.status, 200)
  const rejectBody = (await resReject.json()) as { ok: boolean; id: string }
  assert.equal(rejectBody.ok, true)

  // 2. Prompt Preview für chat-http-1
  const resPreview = await request("/v1/chats/chat-http-1/prompt-preview")
  assert.equal(resPreview.status, 200)
  const previewBody = (await resPreview.json()) as {
    ok: boolean
    layers: { layer1Stable: string; layer2Tools: string; layer3Volatile: string }
    fullPrompt: string
  }
  assert.equal(previewBody.ok, true)
  assert.ok(previewBody.layers.layer1Stable.length > 0)
  assert.ok(previewBody.layers.layer2Tools.length > 0)
  assert.ok(previewBody.fullPrompt.length > 0)

  // 3. Undo History
  const resHistory = await request("/v1/undo/history")
  assert.equal(resHistory.status, 200)
  const histBody = (await resHistory.json()) as {
    ok: boolean
    history: { trash: unknown[]; log: unknown[] }
  }
  assert.equal(histBody.ok, true)
  assert.ok(Array.isArray(histBody.history.trash))
  assert.ok(Array.isArray(histBody.history.log))

  // 4. Mac-Zugriff: Schalter und Rechte (nur lesen; „Anfragen“ mit unbekannter Art wird abgelehnt)
  const access = (await (await request("/v1/mac/access")).json()) as { enabled: boolean; permissions: { id: string; status: string }[] }
  assert.equal(typeof access.enabled, "boolean")
  assert.equal(access.permissions.length, 10)
  assert.ok(access.permissions.every((p) => ["granted", "missing", "unknown"].includes(p.status)))
  const off = (await (await request("/v1/mac/access", { method: "POST", body: JSON.stringify({ enabled: false }) })).json()) as { ok: boolean }
  assert.equal(off.ok, true)
  assert.equal(((await (await request("/v1/mac/access")).json()) as { enabled: boolean }).enabled, false)
  const bad = (await (await request("/v1/mac/permissions/request", { method: "POST", body: JSON.stringify({ id: "kamera" }) })).json()) as { ok: boolean }
  assert.equal(bad.ok, false)

  // 4. Undo Test mit simuliertem Gelöscht-Eintrag
  const snapshotJson = JSON.stringify({
    name: "lieblingsfarbe",
    type: "user",
    description: "Farbe",
    body: "blau",
    stated: true,
    origin: "manual",
    source: "chat",
    version: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  })
  db.prepare(
    `INSERT INTO orbi_memory_trash (bot_id, name, snapshot, deleted_at, reason)
     VALUES ('test-bot-1', 'lieblingsfarbe', ?, ?, 'Benutzer-Löschung')`
  ).run(snapshotJson, Date.now())

  const resUndo = await jsonReq("/v1/undo", "POST", { kind: "memory", orbiId: "test-bot-1" })
  assert.equal(resUndo.status, 200)
  const undoBody = (await resUndo.json()) as { ok: boolean; undone: string; name: string }
  assert.equal(undoBody.ok, true)
  assert.equal(undoBody.undone, "memory")
  assert.equal(undoBody.name, "lieblingsfarbe")
})
