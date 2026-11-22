import assert from "node:assert/strict"
import { test } from "node:test"
import {
  automationInput,
  afterFailedRun,
  isDue,
  keepLatestRuns,
  nextRun,
  shouldAutoPause,
  shouldSkipAutoPause,
  validateMinInterval,
} from "./schedule.ts"

test("Zeitplan berücksichtigt Zeitzonen und Sommerzeit", () => {
  assert.equal(
    nextRun(
      { kind: "daily", at: "08:00" },
      "Europe/Berlin",
      new Date("2026-03-28T08:00:00Z")
    )?.toISOString(),
    "2026-03-29T06:00:00.000Z"
  )
  assert.equal(
    nextRun(
      { kind: "daily", at: "08:00" },
      "America/New_York",
      new Date("2026-01-01T12:30:00Z")
    )?.toISOString(),
    "2026-01-01T13:00:00.000Z"
  )
})
test("Werktage überspringen das Wochenende und Monatstag 31 fällt ans Monatsende", () => {
  assert.equal(
    nextRun(
      { kind: "weekdays", at: "07:30" },
      "Europe/Berlin",
      new Date("2026-10-17T08:00:00Z")
    )?.toISOString(),
    "2026-10-19T05:30:00.000Z"
  )
  assert.equal(
    nextRun(
      { kind: "monthly", at: "09:00", day: 31 },
      "UTC",
      new Date("2026-02-01T00:00:00Z")
    )?.toISOString(),
    "2026-02-28T09:00:00.000Z"
  )
})
test("Einmalige Termine in der Vergangenheit und nicht existierende DST-Uhrzeit", () => {
  assert.equal(
    nextRun(
      { kind: "once", date: "2026-01-01", at: "09:00" },
      "UTC",
      new Date("2026-01-02T00:00:00Z")
    ),
    null
  )
  assert.equal(
    nextRun(
      { kind: "once", date: "2026-01-10", at: "09:00" },
      "UTC",
      new Date("2026-01-02T00:00:00Z")
    )?.toISOString(),
    "2026-01-10T09:00:00.000Z"
  )
  assert.equal(
    nextRun(
      { kind: "daily", at: "02:30" },
      "Europe/Berlin",
      new Date("2026-03-29T00:00:00Z")
    )?.toISOString(),
    "2026-03-30T00:30:00.000Z"
  )
})
test("Fehler beendet nur fällige Einmaltermine ohne nächsten Lauf", () => {
  assert.deepEqual(
    afterFailedRun(
      { kind: "once", date: "2026-01-01", at: "09:00" },
      "UTC",
      new Date("2026-01-02T00:00:00Z")
    ),
    { following: null, disable: true }
  )
  assert.equal(
    afterFailedRun(
      { kind: "once", date: "2026-01-10", at: "09:00" },
      "UTC",
      new Date("2026-01-02T00:00:00Z")
    ).disable,
    false
  )
  assert.equal(
    afterFailedRun(
      { kind: "daily", at: "09:00" },
      "UTC",
      new Date("2026-01-02T00:00:00Z")
    ).disable,
    false
  )
})
test("Eingabe und Laufregeln", () => {
  assert.equal(
    automationInput.safeParse({
      name: "AB",
      prompt: "p",
      schedule: { kind: "daily", at: "08:00" },
      timezone: "Europe/Berlin",
      target: "same",
      notify: "app",
    }).success,
    true
  )
  assert.equal(validateMinInterval(new Date(0), new Date(299_999)), false)
  assert.equal(validateMinInterval(new Date(0), new Date(300_000)), true)
  assert.equal(isDue(true, null, null, new Date(0), new Date(1)), true)
  assert.equal(shouldAutoPause(new Date(0), new Date(14 * 86_400_000)), true)
  assert.equal(shouldAutoPause(null, new Date(10_000_000_000)), false)
  assert.equal(
    shouldAutoPause(new Date(9_999_000_000), new Date(10_000_000_000)),
    false
  )
  const resumedAt = new Date("2026-10-01T00:00:00Z")
  assert.equal(shouldSkipAutoPause(resumedAt, null), true)
  assert.equal(
    shouldSkipAutoPause(resumedAt, new Date("2026-09-30T23:59:59Z")),
    true
  )
  assert.equal(shouldSkipAutoPause(resumedAt, resumedAt), false)
  assert.equal(shouldSkipAutoPause(null, null), false)
  assert.deepEqual(
    keepLatestRuns(Array.from({ length: 22 }, (_, i) => i)).length,
    20
  )
})
