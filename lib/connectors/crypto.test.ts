import assert from "node:assert/strict"
import { test } from "node:test"

import { decryptConnectorAuth, encryptConnectorAuth } from "./crypto.ts"

const original = process.env.CONNECTOR_SECRET
process.env.CONNECTOR_SECRET = Buffer.alloc(32, 7).toString("base64")

test("Token wird round-trip verschlüsselt", () => {
  const encrypted = encryptConnectorAuth("mcp-token")
  assert.equal(encrypted.ok, true)
  if (!encrypted.ok) return
  assert.match(encrypted.value, /^v1:/)
  assert.deepEqual(decryptConnectorAuth(encrypted.value), {
    ok: true,
    value: "mcp-token",
  })
})

test("falsche Version und manipulierter Tag liefern Fehlerwerte", () => {
  const encrypted = encryptConnectorAuth("mcp-token")
  assert.equal(encrypted.ok, true)
  if (!encrypted.ok) return
  assert.equal(
    decryptConnectorAuth(encrypted.value.replace("v1:", "v2:")).ok,
    false
  )
  const parts = encrypted.value.split(":")
  parts[2] = Buffer.alloc(16, 1).toString("base64url")
  assert.equal(decryptConnectorAuth(parts.join(":")).ok, false)
})

test("fehlendes Secret liefert einen Fehlerwert", () => {
  delete process.env.CONNECTOR_SECRET
  assert.deepEqual(encryptConnectorAuth("x"), {
    ok: false,
    error: "CONNECTOR_SECRET fehlt oder ist ungültig.",
  })
  process.env.CONNECTOR_SECRET = original
})
