import assert from "node:assert/strict"
import { test } from "node:test"

import { auth } from "./index.ts"

test("Identität ist lokal und braucht keinen Login", async () => {
  assert.deepEqual(await auth(), { userId: "local" })
})
