import "../../service/src/chat/fixtures/temp-data.ts"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { registerHooks } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, test } from "node:test"

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!context.parentURL?.includes("/node_modules/") && specifier.startsWith(".") && !/\.[cm]?js$|\.ts$/.test(specifier))
      return nextResolve(`${specifier}.ts`, context)
    return nextResolve(specifier, context)
  },
})

const { openDatabase } = await import("../db/client.ts")
const { COLD_AFTER_MS, decideStage, loadStage, saveStage, touchStage, TIER_RANK } = await import("./stage.ts")
const { resolveModel } = await import("./resolve.ts")
const { routeMessage } = await import("./route.ts")

const dir = mkdtempSync(join(tmpdir(), "orbit-stage-"))
after(() => rmSync(dir, { recursive: true, force: true }))
const db = openDatabase(join(dir, "t.sqlite")).$client
db.prepare("insert into chats (id, user_id, kind) values ('c1', 'local', 'direct')").run()

const T0 = 1_000_000_000_000
const state = (tier: "small" | "medium" | "large" | "coding", lastTurnAt = T0, model = "claude-haiku-5-5") => ({
  model,
  effort: "medium",
  tier,
  rank: TIER_RANK[tier],
  lastTurnAt,
})

test("Rang: small < medium < large, coding auf Höhe von large", () => {
  assert.ok(TIER_RANK.small < TIER_RANK.medium && TIER_RANK.medium < TIER_RANK.large)
  assert.equal(TIER_RANK.coding, TIER_RANK.large)
})

test("Entscheidung: Start, Hochstufen nur mit Sicherheit, nie zurück, kalter Cache wählt frei, Ausfall setzt nichts", () => {
  // Neues Gespräch: Jev-Antwort gilt und wird gemerkt.
  assert.deepEqual(decideStage({ state: null, now: T0, answer: { tier: "small", confidence: 0.9 } }), {
    change: "start", tier: "small", persist: true, useRemembered: false,
  })
  // Warm, Jev will mehr und ist sicher: Hochstufung.
  const up = decideStage({ state: state("small"), now: T0 + 60_000, answer: { tier: "large", confidence: 0.8 } })
  assert.equal(up.change, "upgrade")
  assert.equal(up.tier, "large")
  assert.equal(up.persist, true)
  // Warm, Jev will mehr, aber unsicher (unter 0,75): bleibt (der Subagent ist der billigere Weg).
  assert.equal(decideStage({ state: state("small"), now: T0 + 1000, answer: { tier: "large", confidence: 0.7 } }).change, "keep")
  // Warm, Jev will weniger oder gleich: nie zurück.
  for (const tier of ["small", "medium"] as const)
    assert.equal(decideStage({ state: state("medium"), now: T0 + 1000, answer: { tier, confidence: 0.99 } }).change, "keep")
  // Von large aus ist coding kein Aufstieg (andere Familie, Cache weg), von medium aus schon.
  assert.equal(decideStage({ state: state("large", T0, "claude-opus-5-5"), now: T0 + 1000, answer: { tier: "coding", confidence: 0.99 } }).change, "keep")
  assert.equal(decideStage({ state: state("medium", T0, "claude-sonnet-5-5"), now: T0 + 1000, answer: { tier: "coding", confidence: 0.99 } }).change, "upgrade")
  // Jev nicht erreichbar, warm: Modell bleibt, nichts wird als Entscheidung gemerkt.
  const down = decideStage({ state: state("small"), now: T0 + 1000, answer: undefined })
  assert.deepEqual([down.change, down.useRemembered, down.persist], ["keep", true, false])
  // Kalt (Pause länger als der Cache hält): frei neu, auch kleiner.
  const cold = decideStage({ state: state("large", T0, "claude-opus-5-5"), now: T0 + COLD_AFTER_MS + 1, answer: { tier: "small", confidence: 0.9 } })
  assert.deepEqual([cold.change, cold.tier, cold.persist], ["reset", "small", true])
  // Genau an der Grenze ist der Cache schon kalt; eine Millisekunde davor noch warm.
  assert.equal(decideStage({ state: state("large", T0, "claude-opus-5-5"), now: T0 + COLD_AFTER_MS, answer: { tier: "small", confidence: 0.9 } }).change, "reset")
  assert.equal(decideStage({ state: state("large", T0, "claude-opus-5-5"), now: T0 + COLD_AFTER_MS - 1, answer: { tier: "small", confidence: 0.9 } }).change, "keep")
  // Kalt und Jev fällt aus: Standardstufe, nichts merken (kein Aufstieg durch einen Ausfall).
  const fallback = decideStage({ state: null, now: T0, answer: undefined })
  assert.deepEqual([fallback.change, fallback.tier, fallback.persist], ["fallback", "medium", false])
  // Unbekanntes gemerktes Modell zählt als kalt.
  assert.equal(decideStage({ state: { ...state("small"), model: "gibt-es-nicht" }, now: T0 + 1, answer: { tier: "medium", confidence: 0.9 } }).change, "reset")
})

test("Speicher: je Gespräch und Orbi, Warm-Uhr, Löschen mit dem Chat", () => {
  assert.equal(loadStage(db, "c1", "a"), null)
  saveStage(db, "c1", "a", { model: "claude-haiku-5-5", effort: "medium", tier: "small" }, T0)
  saveStage(db, "c1", "b", { model: "claude-opus-5-5", tier: "large" }, T0)
  assert.deepEqual(loadStage(db, "c1", "a"), state("small"))
  assert.equal(loadStage(db, "c1", "b")?.effort, undefined)
  assert.equal(loadStage(db, "c1", "b")?.rank, 2)
  touchStage(db, "c1", "a", T0 + 99)
  assert.equal(loadStage(db, "c1", "a")?.lastTurnAt, T0 + 99)
  saveStage(db, "c1", "a", { model: "claude-sonnet-5-5", effort: "medium", tier: "medium" }, T0 + 100)
  assert.equal(loadStage(db, "c1", "a")?.model, "claude-sonnet-5-5")
  db.prepare("delete from chats where id = 'c1'").run()
  assert.equal(loadStage(db, "c1", "a"), null)
})

// ---- ganze Entscheidung in resolveModel (Jev ist eine Attrappe) ----
const answers = (tier: "small" | "medium" | "large" | "coding", confidence = 0.9) => ({
  loadSettings: async () => ({ auto: true, handoff: false }),
  route: (async (input: { startSmall?: boolean }) => {
    seenStart.push(!!input.startSmall)
    return {
      kind: "route" as const, tier,
      model: { small: "claude-haiku-5-5", medium: "claude-sonnet-5-5", large: "claude-opus-5-5", coding: "gpt-6.1-sol" }[tier],
      modelLabel: tier, effort: "medium", reason: "Passende Modellstufe für die Aufgabe.", confidence, durationMs: 1, source: "jev" as const,
    }
  }) as never,
})
const seenStart: boolean[] = []

test("resolveModel: Start klein, dann nur nach oben, Reset nach Pause, Transparenz im Jev-Eintrag", async () => {
  // 1. Nachricht: neues Gespräch, Jev sagt small -> Haiku, startSmall an, wird gemerkt.
  let r = await resolveModel({ model: "auto" }, "Hallo", { userId: "u", dependencies: answers("small"), stage: { state: null, now: T0 } })
  assert.equal(r.model.id, "claude-haiku-5-5")
  assert.deepEqual(r.stage, { change: "start", tier: "small", persist: true })
  assert.equal(r.jev?.change, "start")
  assert.match(r.jev!.reason, /^Start klein/)
  assert.equal(seenStart.at(-1), true)
  // 2. Nachricht warm, Jev will medium (0,9): Hochstufung auf Sonnet; startSmall aus.
  let s = state("small", T0)
  r = await resolveModel({ model: "auto" }, "Analysiere das", { userId: "u", dependencies: answers("medium"), stage: { state: s, now: T0 + 30_000 } })
  assert.equal(r.model.id, "claude-sonnet-5-5")
  assert.equal(r.stage?.change, "upgrade")
  assert.match(r.jev!.reason, /^Hochgestuft von .* auf /)
  assert.equal(seenStart.at(-1), false)
  // 3. Warm, Jev meint wieder small: Sonnet bleibt (nie zurück).
  s = state("medium", T0, "claude-sonnet-5-5")
  r = await resolveModel({ model: "auto" }, "Danke", { userId: "u", dependencies: answers("small"), stage: { state: s, now: T0 + 60_000 } })
  assert.equal(r.model.id, "claude-sonnet-5-5")
  assert.deepEqual(r.stage, { change: "keep", tier: "medium", persist: false })
  assert.match(r.jev!.reason, /^Bleibt bei /)
  // 4. Nach der Pause darf frei neu gewählt werden: small.
  r = await resolveModel({ model: "auto" }, "Neues Thema", { userId: "u", dependencies: answers("small"), stage: { state: s, now: T0 + COLD_AFTER_MS + 5000 } })
  assert.equal(r.model.id, "claude-haiku-5-5")
  assert.equal(r.stage?.change, "reset")
  assert.equal(seenStart.at(-1), true)
  // 5. Höchste Stufe (large) warm: Jev wird gar nicht erst gefragt.
  let asked = false
  r = await resolveModel({ model: "auto" }, "x", {
    userId: "u",
    dependencies: { loadSettings: async () => ({ auto: true, handoff: false }), route: (async () => { asked = true; throw new Error("nicht erwartet") }) as never },
    stage: { state: state("large", T0, "claude-opus-5-5"), now: T0 + 1000 },
  })
  assert.equal(asked, false)
  assert.equal(r.model.id, "claude-opus-5-5")
})

test("resolveModel: gewähltes Modell (modelPinned) gewinnt und berührt das Gedächtnis nie; Jev-Ausfall setzt keine Untergrenze", async () => {
  const r = await resolveModel({ model: "claude-haiku-5-5", effort: "low", modelPinned: true }, "Schwere Analyse", {
    userId: "u",
    dependencies: answers("large"),
    stage: { state: state("large", T0, "claude-opus-5-5"), now: T0 + 1000 },
  })
  assert.equal(r.model.id, "claude-haiku-5-5")
  assert.equal(r.stage, undefined)
  assert.equal(r.jev, undefined)
  // Jev nicht erreichbar bei neuem Gespräch: Standardstufe, aber nichts gemerkt.
  const down = await resolveModel({ model: "auto" }, "Hi", {
    userId: "u",
    dependencies: { loadSettings: async () => ({ auto: true, handoff: false }), route: (async () => { throw new Error("401") }) as never },
    stage: { state: null, now: T0 },
  })
  assert.equal(down.model.id, "claude-sonnet-5-5")
  assert.deepEqual(down.stage, { change: "fallback", tier: "medium", persist: false })
  // Jev fällt im warmen Gespräch aus: Modell bleibt, keine Hochstufung durch den Ausfall.
  const warmDown = await resolveModel({ model: "auto" }, "Hi", {
    userId: "u",
    dependencies: { loadSettings: async () => ({ auto: true, handoff: false }), route: (async () => { throw new Error("401") }) as never },
    stage: { state: state("small", T0), now: T0 + 1000 },
  })
  assert.equal(warmDown.model.id, "claude-haiku-5-5")
  assert.equal(warmDown.stage?.change, "keep")
})

test("routeMessage: zum Start bei Unsicherheit kleine Stufe, bei Ausfall weiter Standardstufe", async () => {
  const original = globalThis.fetch
  process.env.OPENROUTER_JEV_API_KEY = "test"
  const reply = (choice: string, confidence: number) =>
    new Response(JSON.stringify({ answers: { tier: { choice, confidence } }, usage: { cost: 0.0001 } }), { status: 200, headers: { "content-type": "application/json" } })
  try {
    globalThis.fetch = (async () => reply("large", 0.4)) as typeof fetch
    const unsure = await routeMessage({ text: "Hm", startSmall: true })
    assert.equal(unsure.tier, "small")
    assert.equal(unsure.source, "jev")
    const warmUnsure = await routeMessage({ text: "Hm" })
    assert.equal(warmUnsure.source, "fallback")
    assert.equal(warmUnsure.tier, "medium")
  } finally {
    globalThis.fetch = original
  }
})
