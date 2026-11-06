import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, test } from "node:test"

const dir = mkdtempSync(join(tmpdir(), "orbitd-fleet-routines-"))
process.env.ORBIT_DATA_DIR = dir

const { createApp } = await import("./app.ts")
const { registerApiRoutes } = await import("./routes.ts")
const { oauthCallback } = await import("./oauth-callback.ts")
const { getDatabase } = await import("../../lib/db/client.ts")

const db = getDatabase().$client

// Seed Initialdaten
db.prepare(
  `INSERT INTO bots (id, user_id, third_party_id, name, avatar, job, is_main, version)
   VALUES ('bot-main-1', 'local', 'tp-m1', 'ChefOrbi', 'bot', 'Koordinator', 1, 1),
          ('bot-sub-1', 'local', 'tp-s1', 'WorkerOrbi', 'bot', 'Arbeiter', 0, 1)`
).run()

db.prepare(
  `INSERT INTO chats (id, user_id, kind, name)
   VALUES ('chat-fleet-1', 'local', 'direct', 'Fleet Chat')`
).run()

db.prepare(
  `INSERT INTO chat_members (chat_id, bot_id)
   VALUES ('chat-fleet-1', 'bot-main-1')`
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
  token: "test-fleet-token",
  port: 4321,
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
  app.request(`http://127.0.0.1:4321${path}`, {
    ...init,
    headers: {
      host: "127.0.0.1:4321",
      authorization: "Bearer test-fleet-token",
      ...init.headers,
    },
  })

const jsonReq = (path: string, method: string, body?: unknown) =>
  request(path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

test("HTTP: Routines API (list, get, patch, pause, resume, delete) mit Undo", async () => {
  // 1. Routine anlegen
  const routineId = "routine-test-1"
  db.prepare(
    `INSERT INTO automations (id, user_id, bot_id, name, prompt, schedule, timezone, enabled, next_run_at)
     VALUES (?, 'local', 'bot-main-1', 'Morgenbriefing', 'Erstelle Briefing', '{"kind":"daily","at":"07:00"}', 'Europe/Berlin', 1, 1000)`
  ).run(routineId)

  // 2. GET /v1/routines
  const resList = await request("/v1/routines?botId=bot-main-1")
  assert.equal(resList.status, 200)
  const listData = (await resList.json()) as { ok: boolean; routines: Array<{ id: string; name: string }> }
  assert.equal(listData.ok, true)
  assert.ok(listData.routines.some((r) => r.id === routineId))

  // 3. GET /v1/routines/:id
  const resGet = await request(`/v1/routines/${routineId}`)
  assert.equal(resGet.status, 200)
  const getData = (await resGet.json()) as { ok: boolean; routine: { name: string; enabled: boolean } }
  assert.equal(getData.routine.name, "Morgenbriefing")
  assert.equal(getData.routine.enabled, true)

  // 4. POST /v1/routines/:id/pause
  const resPause = await jsonReq(`/v1/routines/${routineId}/pause`, "POST")
  assert.equal(resPause.status, 200)

  const pausedRow = db.prepare("SELECT enabled FROM automations WHERE id = ?").get(routineId) as { enabled: number }
  assert.equal(pausedRow.enabled, 0)

  // 5. POST /v1/undo stellt Status wieder her
  const resUndo = await jsonReq("/v1/undo", "POST", { kind: "routine" })
  assert.equal(resUndo.status, 200)
  const undoData = (await resUndo.json()) as { ok: boolean; undone: string }
  assert.equal(undoData.ok, true)
  assert.equal(undoData.undone, "routine")

  const restoredRow = db.prepare("SELECT enabled FROM automations WHERE id = ?").get(routineId) as { enabled: number }
  assert.equal(restoredRow.enabled, 1)

  // 6. DELETE /v1/routines/:id (archiviert)
  const resDel = await request(`/v1/routines/${routineId}`, { method: "DELETE" })
  assert.equal(resDel.status, 200)
  const delRow = db.prepare("SELECT deleted_at FROM automations WHERE id = ?").get(routineId) as { deleted_at: number | null }
  assert.ok(delRow.deleted_at)

  // Undo delete
  await jsonReq("/v1/undo", "POST", { kind: "routine" })
  const undeleted = db.prepare("SELECT deleted_at FROM automations WHERE id = ?").get(routineId) as { deleted_at: number | null }
  assert.equal(undeleted.deleted_at, null)
})

test("HTTP: Scratchpad API (get, put, delete)", async () => {
  // 1. GET leer
  const resGet1 = await request("/v1/orbis/bot-main-1/scratchpad")
  assert.equal(resGet1.status, 200)
  const data1 = (await resGet1.json()) as { ok: boolean; scratchpad: string }
  assert.equal(data1.scratchpad, "")

  // 2. PUT
  const resPut = await jsonReq("/v1/orbis/bot-main-1/scratchpad", "PUT", {
    content: "Offene Aufgabe: Angebot für Kunden prüfen",
  })
  assert.equal(resPut.status, 200)

  // 3. GET aktualisiert
  const resGet2 = await request("/v1/orbis/bot-main-1/scratchpad")
  assert.equal(resGet2.status, 200)
  const data2 = (await resGet2.json()) as { ok: boolean; scratchpad: string }
  assert.equal(data2.scratchpad, "Offene Aufgabe: Angebot für Kunden prüfen")

  // 4. DELETE
  const resDel = await request("/v1/orbis/bot-main-1/scratchpad", { method: "DELETE" })
  assert.equal(resDel.status, 200)

  const resGet3 = await request("/v1/orbis/bot-main-1/scratchpad")
  const data3 = (await resGet3.json()) as { ok: boolean; scratchpad: string }
  assert.equal(data3.scratchpad, "")
})

test("HTTP: Orbis Fleet API & Undo", async () => {
  // 1. GET /v1/orbis
  const resList = await request("/v1/orbis")
  assert.equal(resList.status, 200)
  const listData = (await resList.json()) as { ok: boolean; orbis: Array<{ id: string; name: string; version: number; status: string }> }
  assert.ok(listData.orbis.length >= 2)
  const worker = listData.orbis.find((o) => o.id === "bot-sub-1")!
  assert.equal(worker.version, 1)
  assert.equal(worker.status, "frei")

  // 2. PATCH mit falscher expected_version -> 400
  const resConflict = await jsonReq("/v1/orbis/bot-sub-1", "PATCH", {
    expected_version: 99,
    job: "Neuer Job",
  })
  assert.equal(resConflict.status, 400)

  // 3. PATCH mit richtiger expected_version -> 200
  const resOk = await jsonReq("/v1/orbis/bot-sub-1", "PATCH", {
    expected_version: 1,
    job: "Spezial-Entwickler",
  })
  assert.equal(resOk.status, 200)
  const patchData = (await resOk.json()) as { ok: boolean; version: number }
  assert.equal(patchData.version, 2)

  // 4. DELETE /v1/orbis/bot-main-1 (Hauptorbi geschützt -> 400)
  const resMainArchive = await request("/v1/orbis/bot-main-1", { method: "DELETE" })
  assert.equal(resMainArchive.status, 400)

  // 5. DELETE /v1/orbis/bot-sub-1 (Archivieren -> 200)
  const resSubArchive = await request("/v1/orbis/bot-sub-1", { method: "DELETE" })
  assert.equal(resSubArchive.status, 200)

  // 6. Undo stellt archivierten Orbi wieder her
  const resUndo = await jsonReq("/v1/undo", "POST", { kind: "orbi" })
  assert.equal(resUndo.status, 200)
  const undoData = (await resUndo.json()) as { ok: boolean; undone: string }
  assert.equal(undoData.undone, "orbi")

  const unarchived = db.prepare("SELECT archived_at FROM bots WHERE id = 'bot-sub-1'").get() as { archived_at: number | null }
  assert.equal(unarchived.archived_at, null)
})

test("HTTP: Prompt-Preview liefert Abschnitte für die Mac-Ansicht", async () => {
  const res = await request("/v1/chats/chat-fleet-1/prompt-preview")
  assert.equal(res.status, 200)
  const data = (await res.json()) as {
    ok: boolean
    sections: Array<{ id: string; title: string; layer: string }>
    layers: { layer1Stable: string; layer2Tools: string; layer3Volatile: string }
  }
  assert.equal(data.ok, true)
  assert.ok(Array.isArray(data.sections))
  assert.ok(data.sections.length >= 3)
  assert.ok(data.sections.some((s) => s.id === "grok_core"))
  assert.ok(data.sections.some((s) => s.id === "reply_habits"))
})

test("HTTP: Evals Runner Endpunkt liefert Bericht", async () => {
  const res = await jsonReq("/v1/evals/run", "POST", {
    samples: [
      { id: "eval-1", input: "Kurze Frage", output: "Kurze Antwort." },
    ],
  })
  assert.equal(res.status, 200)
  const data = (await res.json()) as {
    ok: boolean
    report: { total: number; nichtBewertet: number }
  }
  assert.equal(data.ok, true)
  assert.equal(data.report.total, 3) // 1 sample x 3 rubrics
  // Ohne konfigurierten LLM-Judge: alle als "nicht bewertet"
  assert.equal(data.report.nichtBewertet, 3)
})
