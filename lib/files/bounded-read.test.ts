import assert from "node:assert/strict"
import { test } from "node:test"

import { parseBoundedSandboxRead } from "./bounded-read.ts"

test("Begrenzter Sandbox-Read übernimmt eine Datei exakt am Limit", () => {
  const data = Buffer.from("12345").toString("base64")
  assert.deepEqual(
    parseBoundedSandboxRead(JSON.stringify({ kind: "file", size: 5, data }), 5),
    { size: 5, data }
  )
})

test("Begrenzter Sandbox-Read verwirft Übergröße ohne Dateiinhalt", () => {
  assert.throws(
    () => parseBoundedSandboxRead(JSON.stringify({ kind: "too_large" }), 5),
    /größer/
  )
})

test("Begrenzter Sandbox-Read prüft die decodierte Länge", () => {
  assert.throws(
    () =>
      parseBoundedSandboxRead(
        JSON.stringify({
          kind: "file",
          size: 4,
          data: Buffer.from("12345").toString("base64"),
        }),
        5
      ),
    /konnte nicht freigegeben/
  )
})
