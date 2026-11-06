import assert from "node:assert/strict"
import { test } from "node:test"

import { sortTools } from "./cache.ts"

test("sortTools: gleiche Menge, gleiche Reihenfolge (stabiler Cache-Präfix)", () => {
  const a = sortTools({ zeta: 1, alpha: 2, mid: 3 })
  const b = sortTools({ mid: 3, zeta: 1, alpha: 2 })
  assert.deepEqual(Object.keys(a), ["alpha", "mid", "zeta"])
  assert.deepEqual(Object.keys(a), Object.keys(b))
})
