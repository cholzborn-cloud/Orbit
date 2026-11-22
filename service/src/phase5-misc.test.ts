import "./chat/fixtures/temp-data.ts"

import assert from "node:assert/strict"
import test from "node:test"

import { startSandbox, setSandboxGate } from "@/lib/chat/sandbox-tools"
import { getDatabase } from "@/lib/db/client"
import { decide, setJevGate } from "@/lib/jev/client"
import { setBudget } from "@/lib/work/budget"
import { createHeartbeat } from "./heartbeat"
import { reloadKeys } from "./keys-api"
import { KEYCHAIN_SERVICE, keyStatus, loadKeychainSecrets, readKeychainKey, type SecurityRunner } from "./keychain"
import { budget, chatSeen, chatStatus, jevGate, sandboxSlots, updateBudget } from "./phase5-api"
import { botHeartbeat, setBotHeartbeat } from "./heartbeat-api"

const db = () => getDatabase().$client
const TEST_SERVICE = "de.consti.orbit2.test-" + process.pid

const fakeKeychain = (items: Record<string, string>) => {
  const calls: string[][] = []
  const run: SecurityRunner = async (args) => {
    calls.push(args)
    const account = args[args.indexOf("-a") + 1]!
    if (args[args.indexOf("-s") + 1] !== TEST_SERVICE || !(account in items)) throw new Error("not found")
    return { stdout: items[account] + "\n" }
  }
  return { run, calls }
}

test("Schlüsselbund: lädt nur fehlende Variablen, Rückfall bleibt, nie der echte Schlüsselbund im Test", async () => {
  const { run, calls } = fakeKeychain({ DAYTONA_API_KEY: "kc-daytona", OPENROUTER_JEV_API_KEY: "kc-jev" })
  const env: NodeJS.ProcessEnv = { DAYTONA_API_KEY: "aus-umgebung" }
  const result = await loadKeychainSecrets({ env, run, service: TEST_SERVICE, platform: "darwin" })
  assert.deepEqual(result.loaded, ["OPENROUTER_JEV_API_KEY"])
  assert.equal(env.DAYTONA_API_KEY, "aus-umgebung") // gesetzte Umgebung gewinnt
  assert.equal(env.OPENROUTER_JEV_API_KEY, "kc-jev")
  assert.equal(env.CLI_PROXY_API_KEY, undefined) // fehlt im Schlüsselbund: secrets.env darf übernehmen
  // Der Wert steht nie in einer Befehlszeile, nur der Name des Kontos und -w zum Lesen.
  for (const args of calls) {
    assert.equal(args[0], "find-generic-password")
    assert.ok(args.includes("-w"))
    assert.equal(args.join(" ").includes("kc-"), false)
  }
  assert.notEqual(TEST_SERVICE, KEYCHAIN_SERVICE)
  assert.equal(KEYCHAIN_SERVICE, "de.consti.orbit2")
})

test("Schlüsselbund: override ersetzt, andere Systeme und Fehler laden nichts", async () => {
  const { run } = fakeKeychain({ DAYTONA_API_KEY: "neu" })
  const env: NodeJS.ProcessEnv = { DAYTONA_API_KEY: "alt" }
  assert.deepEqual((await loadKeychainSecrets({ env, run, service: TEST_SERVICE, platform: "darwin", override: true })).loaded, ["DAYTONA_API_KEY"])
  assert.equal(env.DAYTONA_API_KEY, "neu")
  assert.deepEqual((await loadKeychainSecrets({ env: {}, run, service: TEST_SERVICE, platform: "linux" })).loaded, [])
  assert.equal(await readKeychainKey("DAYTONA_API_KEY", async () => { throw new Error("locked") }, TEST_SERVICE), null)
  assert.equal(await readKeychainKey("X", async () => ({ stdout: "\n" }), TEST_SERVICE), null)
})

test("Schlüssel setzen: reload meldet nur gesetzt/nicht gesetzt und Neustart-Pflicht, nie einen Wert", async () => {
  const env = process.env
  const before = { ...env }
  try {
    env.OPENROUTER_JEV_API_KEY = "alt-jev"
    const { run } = fakeKeychain({ OPENROUTER_JEV_API_KEY: "neu-jev-geheim" })
    const answer = await reloadKeys({}, (options) => loadKeychainSecrets({ ...options, run, service: TEST_SERVICE, platform: "darwin" }))
    assert.deepEqual(answer.needsRestart, []) // alle verwalteten Schlüssel gelten sofort (der Proxy-Schlüssel ist nicht mehr dabei)
    assert.equal(env.OPENROUTER_JEV_API_KEY, "neu-jev-geheim")
    const text = JSON.stringify(answer)
    for (const secret of ["neu-jev-geheim", "alt-jev"]) assert.equal(text.includes(secret), false)
    assert.deepEqual(
      keyStatus(env).map((key) => [key.name, key.set]),
      [["DAYTONA_API_KEY", !!before.DAYTONA_API_KEY], ["OPENROUTER_JEV_API_KEY", true]]
    )
    // Unbekannte Namen werden ignoriert.
    const none = await reloadKeys({ names: ["PATH"] }, async (options) => {
      assert.deepEqual(options.names, [])
      return { loaded: [] }
    })
    assert.deepEqual(none.needsRestart, [])
  } finally {
    for (const key of ["OPENROUTER_JEV_API_KEY"]) {
      if (before[key] === undefined) delete env[key]
      else env[key] = before[key]
    }
  }
})

test("Kostenbudget wirkt: Jev fragt bei aufgebrauchtem Tagesbudget gar nicht an; neue Sandboxes warten", async () => {
  process.env.OPENROUTER_JEV_API_KEY = "test-key"
  const realFetch = globalThis.fetch
  let fetched = 0
  globalThis.fetch = (async () => {
    fetched++
    return new Response("{}", { status: 500 })
  }) as typeof fetch
  try {
    setJevGate(jevGate)
    updateBudget({ jevDailyUsd: 0.1, maxSandboxes: 1 })
    db().prepare("insert into jev_log (id, user_id, kind, cost_usd) values ('j1', 'local', 'route', 0.09)").run()
    const state = budget()
    assert.equal(state.jev.state, "hinweis")
    assert.equal(jevGate(), null)
    db().prepare("insert into jev_log (id, user_id, kind, cost_usd) values ('j2', 'local', 'route', 0.02)").run()
    assert.equal(budget().jev.state, "aus")
    const blocked = await decide({}, {})
    assert.equal(blocked.ok, false)
    assert.match(!blocked.ok ? blocked.error : "", /Tagesbudget/)
    assert.equal(fetched, 0)
    assert.equal(updateBudget({ jevDailyUsd: -5 }).ok, false)
    // Sandbox-Warteschlange: eine Sandbox erlaubt, die zweite wartet nicht ewig und wirft einen Satz ohne „Limit“.
    setSandboxGate({
      acquire: async (id) => (id === "belegt" ? { ok: false, error: "Sandbox wartet: das Tagesbudget erlaubt gerade keine weitere." } : { ok: true }),
    })
    await assert.rejects(() => startSandbox("belegt"), (error: Error) => /Sandbox wartet/.test(error.message) && !/limit/i.test(error.message))
    assert.equal(sandboxSlots.active(), 0)
  } finally {
    globalThis.fetch = realFetch
    setJevGate(undefined)
    setSandboxGate(undefined)
    delete process.env.OPENROUTER_JEV_API_KEY
  }
})

test("Status und Gesehen über die Schnittstelle", () => {
  db().prepare("insert into chats (id, user_id, kind, last_message_preview, last_message_at, created_at) values ('sc', 'local', 'direct', 'x', 5000, 1)").run()
  assert.equal(chatStatus().chats.find((c) => c.chatId === "sc")?.isNew, true)
  assert.deepEqual(chatSeen("fremd"), { ok: false, error: "Chat nicht gefunden." })
  assert.deepEqual(chatSeen("sc"), { ok: true })
  assert.equal(chatStatus().chats.find((c) => c.chatId === "sc"), undefined)
})

test("Heartbeat im Dienst: nur bei Mac-Aktivität, schreibt eine leise Nachricht in den Chat des Orbis, Schalter wirkt", async () => {
  db().prepare("insert into bots (id, user_id, third_party_id, name, job, avatar) values ('hb', 'local', 'hb', 'Nova', 'J', 'a')").run()
  db().prepare("insert into chats (id, user_id, kind, created_at, last_message_at) values ('hbc', 'local', 'direct', 1, 1)").run()
  db().prepare("insert into chat_members (chat_id, bot_id) values ('hbc', 'hb')").run()
  db().prepare("insert into automations (id, user_id, bot_id, name, prompt, schedule) values ('ha', 'local', 'hb', 'Bericht', 'p', '{}')").run()
  assert.equal((botHeartbeat("hb") as { enabled: boolean }).enabled, false)
  assert.equal(setBotHeartbeat("hb", { enabled: "ja" }).ok, false)
  assert.equal((setBotHeartbeat("hb", { enabled: true }) as { enabled: boolean }).enabled, true)

  const posted: { chatId: string; text: string; role: string }[] = []
  let idle: number | null = 5
  let modelCalls = 0
  const hb = createHeartbeat({
    store: { upsertMessage: async (chatId, message) => void posted.push({ chatId, role: message.role, text: (message.parts[0] as { text: string }).text }) },
    generate: async () => {
      modelCalls++
      return { text: "Dein Bericht ist fertig." }
    },
    idleSeconds: async () => idle,
  })
  // Zeitfenster hängt an der Ortszeit des Macs: ein Zeitpunkt mittags Ortszeit.
  const noon = (addMin: number) => new Date(new Date(2026, 10, 2, 12, addMin).getTime())
  await hb.tick(noon(0)) // legt den ersten Termin an
  db().prepare("insert into automation_runs (id, automation_id, user_id, status, started_at, finished_at) values ('hr', 'ha', 'local', 'ok', ?, ?)").run(noon(10).getTime(), noon(11).getTime())
  idle = 3600 // Mac seit einer Stunde ohne Eingabe
  await hb.tick(noon(31))
  assert.equal(modelCalls, 0)
  assert.deepEqual(posted, [])
  idle = null // unbekannt gilt als nicht aktiv
  await hb.tick(noon(32))
  assert.equal(modelCalls, 0)
  idle = 10
  const results = await hb.tick(noon(33))
  assert.deepEqual(results, [{ status: "posted", text: "Dein Bericht ist fertig." }])
  assert.deepEqual(posted, [{ chatId: "hbc", role: "assistant", text: "Dein Bericht ist fertig." }])
  // Gleich danach nicht wieder (Termin steht erst in 30 Minuten an).
  assert.deepEqual(await hb.tick(noon(34)), [])
  // Ausschalten: nie mehr.
  setBotHeartbeat("hb", { enabled: false })
  db().prepare("update orbi_heartbeat set next_run_at = 0 where bot_id = 'hb'").run()
  assert.deepEqual(await hb.tick(noon(90)), [])
  setBudget(db(), { maxSandboxes: 3 })
})
