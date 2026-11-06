import assert from "node:assert/strict"
import test from "node:test"

import { ASK_USER_DESCRIPTION, answeredAskUser, askUserInput } from "./ask-user.ts"

const msg = (parts: { type: string; state?: string }[]) => [
  { role: "assistant", parts },
]

test("weiter nur nach beantworteter Frage im letzten Schritt", () => {
  assert.equal(
    answeredAskUser({
      messages: msg([
        { type: "step-start" },
        { type: "tool-ask_user", state: "output-available" },
      ]),
    }),
    true
  )
  assert.equal(
    answeredAskUser({
      messages: msg([{ type: "tool-ask_user", state: "input-available" }]),
    }),
    false
  )
  assert.equal(
    answeredAskUser({
      messages: msg([
        { type: "tool-ask_user", state: "output-available" },
        { type: "step-start" },
        { type: "text" },
      ]),
    }),
    false
  )
})

test("Rückfrage: 2 bis 4 Optionen, keine Planbestätigung", () => {
  const options = (n: number) => Array.from({ length: n }, (_, i) => ({ label: `O${i}` }))
  const parse = (n: number) => askUserInput.safeParse({ questions: [{ question: "Q?", options: options(n) }] }).success
  assert.deepEqual([1, 2, 4, 5].map(parse), [false, true, true, false])
  assert.equal(/plan confirmation/i.test(ASK_USER_DESCRIPTION), false)
})
