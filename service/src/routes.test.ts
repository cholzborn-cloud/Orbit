import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

// Eigene Testdatei, nie die persönlichen App-Daten.
const dir = mkdtempSync(join(tmpdir(), "orbitd-routes-"))
process.env.ORBIT_DATA_DIR = dir
const { createApp } = await import("./app.ts")
const { registerApiRoutes } = await import("./routes.ts")
const { oauthCallback } = await import("./oauth-callback.ts")
const { getDatabase } = await import("@/lib/db/client")

const started: string[] = []
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
      start: (id) => {
        started.push(id)
        return { runId: "run", done: Promise.resolve() }
      },
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
const json = (path: string, method: string, body?: unknown) =>
  request(path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

test("REST: Token Pflicht, Action-Ergebnis als Körper, Fehler mit Status", async () => {
  assert.equal(
    (await request("/v1/settings", { headers: { authorization: "" } })).status,
    401
  )
  const settings = await request("/v1/settings")
  assert.equal(settings.status, 200)
  assert.equal(((await settings.json()) as { ok: boolean }).ok, true)
  assert.deepEqual(
    await (await json("/v1/settings/theme", "PUT", { theme: "dark" })).json(),
    { ok: true }
  )
  const invalid = await json("/v1/settings/theme", "PUT", { theme: "pink" })
  assert.equal(invalid.status, 400)
  assert.deepEqual(await invalid.json(), {
    ok: false,
    error: "Ungültiges Design.",
  })
  // Phase 3 Korrektur: kein Regler für die Antwortlänge mehr.
  assert.equal((await json("/v1/settings/reply-length", "PUT", { replyLength: "long" })).status, 404)
  assert.equal("replyLength" in ((await (await request("/v1/settings")).json()) as object), false)
  assert.equal((await json("/v1/settings/jev", "PUT", "{kaputt")).status, 400)
  const broken = await request("/v1/skills", {
    method: "POST",
    body: "{kaputt",
  })
  assert.equal(broken.status, 400)
  assert.deepEqual(await broken.json(), { error: "Ungültige Anfrage." })
  const missing = await request("/v1/nope")
  assert.equal(missing.status, 404)
  assert.deepEqual(await missing.json(), { error: "Nicht gefunden." })
})

test("REST: Automation starten prüft Besitz, Lauf geht an den Runner", async () => {
  const missing = await json("/v1/automations/gibt-es-nicht/run", "POST")
  assert.equal(missing.status, 404)
  const sqlite = getDatabase().$client
  sqlite
    .prepare(
      "insert into bots (id, user_id, third_party_id, name, job, avatar) values ('b','local','b','B','J','a')"
    )
    .run()
  sqlite
    .prepare(
      "insert into automations (id, user_id, bot_id, name, prompt, schedule, next_run_at) values ('a','local','b','n','p','{\"kind\":\"daily\",\"at\":\"08:00\"}',1)"
    )
    .run()
  const ok = await json("/v1/automations/a/run", "POST")
  assert.equal(ok.status, 200)
  assert.deepEqual(await ok.json(), { ok: true, runId: "run" })
  assert.deepEqual(started, ["a"])
})

test("Preflight erlaubt PUT/PATCH nur von der Web-App", async () => {
  const preflight = (origin: string, method: string) =>
    request("/v1/settings/theme", {
      method: "OPTIONS",
      headers: {
        authorization: "",
        origin,
        "access-control-request-method": method,
      },
    })
  assert.equal((await preflight("http://localhost:3000", "PUT")).status, 204)
  assert.equal((await preflight("http://localhost:3000", "PATCH")).status, 204)
  assert.notEqual((await preflight("http://evil.test", "PUT")).status, 204)
})

test("OAuth-Rücksprung: ohne Token erreichbar, aber nur mit Host-Prüfung und bekanntem State", async () => {
  const bare = { headers: { authorization: "" } }
  const aborted = await request("/oauth/callback?error=access_denied", bare)
  assert.equal(aborted.status, 200)
  assert.match(await aborted.text(), /abgebrochen/)
  const unknown = await request("/oauth/callback?code=c&state=unbekannt", bare)
  const html = await unknown.text()
  assert.match(html, /gehört zu keinem Konnektor/)
  assert.match(
    html,
    /postMessage\(\{type:"orbit-connector-oauth",ok:false\},"http:\/\/localhost:3000"\)/
  )
  const wrongHost = await request("/oauth/callback?code=c&state=s", {
    headers: { authorization: "", host: "evil.test" },
  })
  assert.equal(wrongHost.status, 403)
  const wrongOrigin = await request("/oauth/callback?code=c&state=s", {
    headers: { authorization: "", origin: "http://evil.test" },
  })
  assert.equal(wrongOrigin.status, 403)
  // Andere Pfade bleiben tokenpflichtig.
  assert.equal((await request("/v1/health", bare)).status, 401)
})

test("Modelle: Verfügbarkeit passt zur Liste, Auto gehört nicht hinein", async () => {
  const body = (await (await request("/v1/models")).json()) as {
    ok: boolean
    modelsAvailable: boolean
    models: { id: string; efforts: string[] }[]
  }
  assert.equal(body.ok, true)
  assert.equal(body.modelsAvailable, body.models.length > 0)
  assert.ok(body.models.every((m) => m.id !== "auto" && Array.isArray(m.efforts)))
})

test("REST: Gedächtnis eines Orbis lesen und Eintrag löschen (Mac-App)", async () => {
  const { saveEntry } = await import("@/lib/orbi/local-memory")
  const sqlite = getDatabase().$client
  sqlite.prepare("insert into bots (id, user_id, third_party_id, name, job, avatar) values ('mem','local','m','M','J','a')").run()
  saveEntry(sqlite, "mem", { name: "tee", type: "user", description: "Consti mag Tee", body: "Abends Tee.", from: "consti", source: "Consti im Chat" })
  const list = (await (await request("/v1/bots/mem/memory")).json()) as { ok: boolean; entries: { name: string; stated: boolean }[]; index: string; migrated: boolean }
  assert.equal(list.ok, true)
  assert.deepEqual(list.entries.map((e) => [e.name, e.stated]), [["tee", true]])
  assert.match(list.index, /- tee \[u /)
  const one = (await (await request("/v1/bots/mem/memory/tee")).json()) as { entry: { body: string; version: number } }
  assert.deepEqual([one.entry.body, one.entry.version], ["Abends Tee.", 1])
  assert.equal((await request("/v1/bots/mem/memory/gibt-es-nicht")).status, 404)
  assert.equal((await request("/v1/bots/fremd/memory")).status, 404)
  assert.equal((await request("/v1/bots/mem/memory", { headers: { authorization: "" } })).status, 401)
  assert.equal((await request("/v1/bots/mem/memory/tee", { method: "DELETE" })).status, 200)
  assert.equal((await request("/v1/bots/mem/memory/tee", { method: "DELETE" })).status, 404)
  assert.deepEqual(((await (await request("/v1/bots/mem/memory")).json()) as { entries: unknown[] }).entries, [])
})

test("Orbi bearbeiten erhält die bisherige Anweisung unverändert", async () => {
  const sqlite = getDatabase().$client
  sqlite.prepare("insert into bots (id, user_id, third_party_id, name, job, avatar, instructions) values (?, ?, ?, ?, ?, ?, ?)")
    .run("keep-notes", "local", "keep-notes", "Früher", "Planung", "strobi", "Alte Notiz bleibt erhalten")
  const result = await json("/v1/bots/keep-notes", "PATCH", {
    name: "Neu", avatar: "strobi", color: null, isMain: false, job: "Recherche", instructions: "", look: null,
  })
  assert.equal(result.status, 200)
  assert.deepEqual(sqlite.prepare("select name, job, instructions from bots where id = ?").get("keep-notes"), {
    name: "Neu", job: "Recherche", instructions: "Alte Notiz bleibt erhalten",
  })
})

test("Aufräumen", () => {
  getDatabase().$client.close()
  rmSync(dir, { recursive: true, force: true })
})

test("REST: Marktplatz-Katalog und Standard-Anleitung für die Einstellungen", async () => {
  const market = (await (await request("/v1/marketplace")).json()) as {
    ok: boolean
    entries: { id: string; type: string }[]
  }
  assert.equal(market.ok, true)
  assert.ok(market.entries.length > 0 && market.entries.every((e) => e.id && e.type))
  const base = (await (await request("/v1/settings/instructions/default")).json()) as {
    text: string
    limit: number
  }
  assert.ok(base.text.length > 0 && base.limit === 8000)
})

test("REST: ungültige Kalender-Zugänge werden nicht als verbunden akzeptiert", async () => {
  const fakePassword = "not-an-app-password"
  const response = await json("/v1/icloud/verify", "POST", {appleId:"test@example.invalid",appPassword:fakePassword})
  assert.equal(response.status, 400)
  const text = await response.text()
  assert.equal(text.includes(fakePassword), false)
  assert.equal(JSON.parse(text).ok, false)
})
