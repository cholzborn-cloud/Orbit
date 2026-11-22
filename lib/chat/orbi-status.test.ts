import assert from "node:assert/strict"
import test from "node:test"

import { orbiStatus } from "./orbi-status.ts"

test("Orbi-Status bildet Fehler, Freigaben, Tools, Handoffs, Stream und Abschluss ab", () => {
  assert.equal(orbiStatus({ chatStatus: "ready" }), "ruhig")
  assert.equal(orbiStatus({ chatStatus: "streaming" }), "denkt")
  assert.equal(
    orbiStatus({
      chatStatus: "ready",
      lastAssistant: {
        parts: [{ type: "tool-search", state: "input-streaming" }],
      },
    }),
    "arbeitet"
  )
  assert.equal(
    orbiStatus({
      chatStatus: "ready",
      lastAssistant: {
        parts: [{ type: "tool-search", state: "approval-requested" }],
      },
    }),
    "wartet"
  )
  assert.equal(orbiStatus({ chatStatus: "error" }), "blockiert")
  assert.equal(
    orbiStatus({ chatStatus: "ready", error: new Error() }),
    "blockiert"
  )
  assert.equal(
    orbiStatus({
      chatStatus: "ready",
      lastAssistant: { createdAt: 9000 },
      now: 10000,
    }),
    "fertig"
  )
  assert.equal(
    orbiStatus({
      chatStatus: "ready",
      lastAssistant: { createdAt: 5000 },
      now: 10000,
    }),
    "ruhig"
  )
  assert.equal(
    orbiStatus({
      chatStatus: "ready",
      lastAssistant: {
        parts: [{ type: "tool-handoff", state: "input-available" }],
      },
    }),
    "arbeitet"
  )
})
