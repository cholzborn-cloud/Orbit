import assert from "node:assert/strict"
import { test } from "node:test"

import { AUTOMATION_LIMITS, checkAutomationLimits } from "./limits.ts"

const daily = (at: string, enabled = true) => ({ schedule: { kind: "daily", at }, enabled })

test("Automation-Limits: Anzahl, Läufe pro Tag, Mindestabstand", () => {
  assert.equal(checkAutomationLimits([], { kind: "daily", at: "08:00" }), null)
  const many = Array.from({ length: AUTOMATION_LIMITS.perBot }, (_, i) => daily(`0${i % 10}:00`, false))
  assert.match(checkAutomationLimits(many, { kind: "daily", at: "12:00" }) ?? "", /bereits 50/)
  const busy = Array.from({ length: AUTOMATION_LIMITS.runsPerDay }, (_, i) => daily(`${String(i + 8).padStart(2, "0")}:00`))
  assert.match(checkAutomationLimits(busy, { kind: "daily", at: "23:45" }) ?? "", /Läufe pro Tag/)
  assert.match(checkAutomationLimits([daily("08:00")], { kind: "weekdays", at: "08:05" }) ?? "", /Mindestabstand 10/)
  assert.equal(checkAutomationLimits([daily("08:00")], { kind: "weekdays", at: "08:10" }), null)
  // Pausierte zählen für Abstand und Tageslimit nicht.
  assert.equal(checkAutomationLimits([daily("08:00", false)], { kind: "daily", at: "08:01" }), null)
})
