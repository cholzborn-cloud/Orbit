import assert from "node:assert/strict"
import test from "node:test"

import type { RoundPlan } from "../../../lib/chat/group-round.ts"
import { continueRound, type MemberOutcome, type MemberTurn } from "./group-round.ts"

const spoke: MemberOutcome = { spoke: true, aborted: false, failed: false }
const silent: MemberOutcome = { spoke: false, aborted: false, failed: false }
const plan = (marked: string[] = [], order = ["a", "b", "c"], fallback = "c"): RoundPlan => ({ order, marked, fallback })

function run(options: {
  plan: RoundPlan
  first: MemberOutcome | null
  answers: Record<string, MemberOutcome | ((turn: MemberTurn) => MemberOutcome)>
  requireAnswer?: boolean
  abortAfter?: number
}) {
  const log: string[] = []
  return {
    log,
    done: continueRound({
      plan: options.plan,
      first: options.first,
      requireAnswer: options.requireAnswer ?? true,
      isAborted: () => options.abortAfter !== undefined && log.length >= options.abortAfter,
      runMember: async (id, turn) => {
        log.push(`${id}${turn.forced ? "!" : ""}`)
        const a = options.answers[id] ?? silent
        return typeof a === "function" ? a(turn) : a
      },
    }),
  }
}

test("Runde: Mitglieder nacheinander, Schweigen ist erlaubt", async () => {
  const r = run({ plan: plan(), first: spoke, answers: { b: silent, c: spoke } })
  const result = await r.done
  assert.deepEqual(r.log, ["b", "c"])
  assert.deepEqual(result.spoke.sort(), ["a", "c"])
  assert.deepEqual(result.silent, ["b"])
})

test("Runde: Markierter schweigt, einmaliger Nachlauf mit Hinweis; schweigt er wieder, kein dritter Versuch", async () => {
  const answered = run({ plan: plan(["b"]), first: spoke, answers: { b: (t) => (t.forced ? spoke : silent) } })
  assert.deepEqual((await answered.done).spoke.sort(), ["a", "b"])
  assert.deepEqual(answered.log, ["b", "b!", "c"])
  const stubborn = run({ plan: plan(["b"]), first: spoke, answers: { b: silent } })
  await stubborn.done
  assert.deepEqual(stubborn.log, ["b", "b!", "c"])
})

test("Runde: das erste Mitglied ist markiert und hat geschwiegen, dann Nachlauf für es", async () => {
  const r = run({ plan: plan(["a"]), first: silent, answers: { a: spoke } })
  const result = await r.done
  assert.deepEqual(r.log, ["a!", "b", "c"])
  assert.deepEqual(result.spoke, ["a"])
})

test("Rückfall wiederholt keinen bereits zweimal versuchten markierten Orbi", async () => {
  const r = run({ plan: plan(["a"], ["a", "b", "c"], "a"), first: silent, answers: {} })
  await r.done
  assert.deepEqual(r.log, ["a!", "b", "c", "b!"])
  const alone = run({ plan: plan(["a"], ["a"], "a"), first: silent, answers: {} })
  await alone.done
  assert.deepEqual(alone.log, ["a!"])
})

test("Runde: schweigen alle, antwortet der Rückfall mit Hinweis (nur bei Nachricht von Consti)", async () => {
  const r = run({ plan: plan([], ["a", "b", "c"], "b"), first: silent, answers: { b: (t) => (t.forced ? spoke : silent) } })
  const result = await r.done
  assert.deepEqual(r.log, ["b", "c", "b!"])
  assert.deepEqual(result.spoke, ["b"])
  const byOrbi = run({ plan: plan(), first: silent, answers: {}, requireAnswer: false })
  assert.deepEqual((await byOrbi.done).spoke, [])
  assert.deepEqual(byOrbi.log, ["b", "c"])
})

test("Runde: Stopp zwischen den Mitgliedern oder im laufenden Turn beendet alles, auch den Rückfall", async () => {
  const between = run({ plan: plan(), first: silent, answers: {}, abortAfter: 1 })
  const result = await between.done
  assert.deepEqual(between.log, ["b"])
  assert.equal(result.stopped, true)
  const inTurn = run({ plan: plan(), first: spoke, answers: { b: { spoke: false, aborted: true, failed: false } } })
  assert.equal((await inTurn.done).stopped, true)
  assert.deepEqual(inTurn.log, ["b"])
})

test("Runde: ohne ersten Ausgang beginnt sie beim ersten Mitglied; ein Fehlschlag stoppt die anderen nicht", async () => {
  const r = run({ plan: plan(), first: null, answers: { a: { spoke: false, aborted: false, failed: true }, b: spoke } })
  const result = await r.done
  assert.deepEqual(r.log, ["a", "b", "c"])
  assert.deepEqual(result.spoke, ["b"])
})
