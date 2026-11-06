import assert from "node:assert/strict"
import { test } from "node:test"

import { everySchedule, inWindow, nextEvery } from "./schedule.ts"

const s = everySchedule.parse({ kind: "every", minutes: 30, from: "08:00", to: "22:00" })
const at = (h: number, m = 0) => new Date(Date.UTC(2026, 10, 2, h, m))

test("every: Prüfung der Eingabe", () => {
  assert.equal(everySchedule.safeParse({ kind: "every", minutes: 2, from: "08:00", to: "22:00" }).success, false)
  assert.equal(everySchedule.safeParse({ kind: "every", minutes: 30, from: "8:00", to: "22:00" }).success, false)
  assert.equal(everySchedule.safeParse({ kind: "every", minutes: 30, from: "08:00", to: "24:00" }).success, false)
})

test("Zeitfenster: innen, außen, über Mitternacht, ganztägig", () => {
  assert.equal(inWindow(s, at(7, 59), "UTC"), false)
  assert.equal(inWindow(s, at(8, 0), "UTC"), true)
  assert.equal(inWindow(s, at(21, 59), "UTC"), true)
  assert.equal(inWindow(s, at(22, 0), "UTC"), false)
  const night = { ...s, from: "22:00", to: "06:00" }
  assert.equal(inWindow(night, at(23), "UTC"), true)
  assert.equal(inWindow(night, at(5, 30), "UTC"), true)
  assert.equal(inWindow(night, at(12), "UTC"), false)
  assert.equal(inWindow({ ...s, from: "00:00", to: "00:00" }, at(3), "UTC"), true)
  // Zeitzone zählt: 07:00 UTC ist 08:00 in Berlin (Winterzeit).
  assert.equal(inWindow(s, at(7), "Europe/Berlin"), true)
})

test("nächster Termin = jetzt + Intervall", () => {
  assert.equal(nextEvery(s, at(10)).toISOString(), at(10, 30).toISOString())
})
