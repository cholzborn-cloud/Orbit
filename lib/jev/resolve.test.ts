import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import { test } from "node:test"

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      !context.parentURL?.includes("/node_modules/") &&
      specifier.startsWith(".") &&
      !/\.[cm]?js$|\.ts$/.test(specifier)
    )
      return nextResolve(`${specifier}.ts`, context)
    return nextResolve(specifier, context)
  },
})

const { loadJevSettings, normalizeEffort, resolveModel } = await import("./resolve.ts")

test("Auto-Modell nutzt Jev-Stufe und begrenzt den Eingabetext", async () => {
  let received = ""
  const result = await resolveModel({ model: "auto" }, "x".repeat(3000), {
    userId: "u1",
    dependencies: {
      loadSettings: async () => ({ auto: true, handoff: false }),
      route: async ({ text }) => {
        received = text
        return {
          kind: "route",
          tier: "coding",
          model: "gpt-6.1-sol",
          modelLabel: "Sol 6.1",
          effort: "medium",
          reason: "coding",
          durationMs: 1,
          source: "jev",
        }
      },
    },
  })
  assert.equal(received.length, 2000)
  assert.equal(result.model.id, "gpt-6.1-sol")
  assert.equal(result.effort, "medium")
  assert.equal(result.jev?.source, "jev")
})

test("Auto aus umgeht Jev und wählt das Standardmodell", async () => {
  let called = false
  const result = await resolveModel({ model: "auto" }, "Hallo", {
    userId: "u1",
    dependencies: {
      loadSettings: async () => ({ auto: false, handoff: false }),
      route: async () => {
        called = true
        throw new Error("nicht erwartet")
      },
    },
  })
  assert.equal(called, false)
  assert.equal(result.model.id, "claude-sonnet-5-5")
  assert.equal(result.jev, undefined)
})

test("Jev-Fehler verwendet Fallback mit Jev-Info", async () => {
  const result = await resolveModel({ model: "auto" }, "Hallo", {
    userId: "u1",
    dependencies: {
      loadSettings: async () => ({ auto: true, handoff: false }),
      route: async () => {
        throw new Error("offline")
      },
    },
  })
  assert.equal(result.model.id, "claude-sonnet-5-5")
  assert.equal(result.jev?.source, "fallback")
})

test("Nicht geladene Einstellungen deaktivieren Jev fail-closed", async () => {
  let called = false
  const result = await resolveModel({ model: "auto" }, "Privater Text", {
    userId: "u1",
    dependencies: {
      loadSettings: async () => {
        throw new Error("Datenbank offline")
      },
      route: async () => {
        called = true
        throw new Error("nicht erwartet")
      },
    },
  })
  assert.equal(called, false)
  assert.equal(result.model.id, "claude-sonnet-5-5")
  assert.equal(result.jev?.source, "fallback")
  assert.match(result.jev?.reason ?? "", /Einstellungen konnten nicht geladen/)
})

test("Jev bleibt unabhängig von alten Einstellungen für Modellwahl und Übergaben aktiv", async () => {
  const settings = await loadJevSettings("u1", { sql: async () => [{ jev_auto: false, jev_handoff: false }] })
  assert.deepEqual(settings, { auto: true, handoff: true })
})

test("Unpassende oder fehlende Stufe fällt auf die Standardstufe des Modells, kein Fehler", async () => {
  // Gemini hat über die CLI keine Stufe: jede Angabe entfällt. Unbekannte Stufe bei Claude -> Mid. Modell ohne Stufe angegeben -> Mid.
  const gemini = await resolveModel({ model: "gemini-3.8-flash-high", effort: "xhigh" }, "x")
  assert.equal(gemini.effort, undefined)
  const unknown = await resolveModel({ model: "claude-sonnet-5-5", effort: "ultra" }, "x")
  assert.equal(unknown.effort, "medium")
  const none = await resolveModel({ model: "claude-sonnet-5-5" }, "x")
  assert.equal(none.effort, "medium")
  const ok = await resolveModel({ model: "claude-sonnet-5-5", effort: "max" }, "x")
  assert.equal(ok.effort, "max")
  const model = { efforts: ["low", "high"] } as never
  assert.equal(normalizeEffort(model, "xhigh"), "low")
  assert.equal(normalizeEffort({ efforts: [] } as never, "high"), undefined)
  // Auto: unpassende Stufe aus der Jev-Antwort ebenso
  const auto = await resolveModel({ model: "auto" }, "x", {
    userId: "u",
    dependencies: {
      loadSettings: async () => ({ auto: true, handoff: false }),
      route: async () => ({
        kind: "route", tier: "fast", model: "claude-haiku-5-5", modelLabel: "Haiku 5.5",
        effort: "ultra", reason: "r", durationMs: 1, source: "jev",
      }),
    },
  })
  assert.equal(auto.effort, "medium")
})
