import assert from "node:assert/strict"
import test from "node:test"

import { ActiveDeadline } from "./deadline.ts"

function fakeTime() {
  let now = 0
  let serial = 0
  const timers = new Map<number, { callback: () => void; at: number }>()
  return {
    options: {
      now: () => now,
      setTimer: (callback: () => void, milliseconds: number) => {
        const id = ++serial
        timers.set(id, { callback, at: now + milliseconds })
        return () => {
          timers.delete(id)
        }
      },
    },
    pending: () => timers.size,
    advance(milliseconds: number) {
      const end = now + milliseconds
      while (true) {
        const next = [...timers.entries()]
          .filter(([, timer]) => timer.at <= end)
          .sort((a, b) => a[1].at - b[1].at)[0]
        if (!next) break
        now = next[1].at
        timers.delete(next[0])
        next[1].callback()
      }
      now = end
    },
  }
}

test("200 Sekunden Aktivzeit bleiben nach zehn Minuten Pause als Restlimit erhalten", () => {
  const time = fakeTime()
  const deadline = new ActiveDeadline(200_000, time.options)
  time.advance(70_000)
  deadline.pause(true)
  assert.equal(time.pending(), 0)
  time.advance(600_000)
  assert.equal(deadline.signal.aborted, false)
  deadline.pause(false)
  time.advance(129_999)
  assert.equal(deadline.signal.aborted, false)
  time.advance(1)
  assert.equal(deadline.signal.aborted, true)
  assert.equal(deadline.signal.reason instanceof DOMException, true)
  assert.equal(deadline.signal.reason.name, "TimeoutError")
  assert.equal(time.pending(), 0)
})

test("Wiederholtes Pausieren und Fortsetzen akkumuliert aktive Zeit ohne neue Frist", () => {
  const time = fakeTime()
  const deadline = new ActiveDeadline(200_000, time.options)
  time.advance(40_000)
  deadline.pause(false)
  assert.equal(time.pending(), 1)
  time.advance(10_000)
  deadline.pause(true)
  time.advance(5_000)
  deadline.pause(true)
  assert.equal(time.pending(), 0)
  deadline.pause(false)
  time.advance(60_000)
  deadline.pause(true)
  time.advance(600_000)
  deadline.pause(false)
  deadline.pause(false)
  assert.equal(time.pending(), 1)
  time.advance(89_999)
  assert.equal(deadline.signal.aborted, false)
  time.advance(1)
  assert.equal(deadline.signal.aborted, true)
  deadline.pause(false)
  deadline.pause(true)
  assert.equal(time.pending(), 0)
})

test("Dispose entfernt Timer und verhindert spätere Reaktivierung ohne Abort", () => {
  for (const waiting of [false, true]) {
    const time = fakeTime()
    const deadline = new ActiveDeadline(200_000, time.options)
    time.advance(1_000)
    deadline.pause(waiting)
    deadline.dispose()
    deadline.dispose()
    deadline.pause(false)
    assert.equal(time.pending(), 0)
    time.advance(1_000_000)
    assert.equal(deadline.signal.aborted, false)
  }
})

test("Ablauf sendet genau einen Abort mit TimeoutError", () => {
  const time = fakeTime()
  const deadline = new ActiveDeadline(0, time.options)
  let aborted = 0
  deadline.signal.addEventListener("abort", () => {
    aborted++
  })
  time.advance(0)
  assert.equal(aborted, 1)
  const reason = deadline.signal.reason
  deadline.pause(false)
  deadline.dispose()
  time.advance(1_000)
  assert.equal(aborted, 1)
  assert.equal(deadline.signal.reason, reason)
  assert.equal(reason.name, "TimeoutError")
})
