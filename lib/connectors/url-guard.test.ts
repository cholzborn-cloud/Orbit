import assert from "node:assert/strict"
import { test } from "node:test"

import {
  inspectConnectorUrl,
  privateAddress,
  resolveConnectorUrl,
} from "./url-guard.ts"

test("private, loopback, link-local, shared and mapped addresses are blocked", () => {
  for (const ip of [
    "127.0.0.1",
    "10.1.1.1",
    "172.16.0.1",
    "172.31.1.1",
    "192.168.1.1",
    "169.254.1.1",
    "100.64.0.1",
    "::1",
    "0:0:0:0:0:0:0:1",
    "fc00::1",
    "fd00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "0:0:0:0:0:ffff:7f00:1",
    "192.0.0.1",
    "198.18.0.1",
    "224.0.0.1",
    "240.0.0.1",
    "::7f00:1",
    "64:ff9b::1",
    "2002::1",
    "fec0::1",
    "ff00::1",
  ])
    assert.equal(privateAddress(ip), true, ip)
})

test("URL-Grenzfälle werden vor einer DNS-Abfrage erkannt", () => {
  for (const url of [
    "http://example.com",
    "https://name:secret@example.com",
    "https://example.com:444",
    "https://localhost",
    "https://service.local",
    "https://service.internal",
    "https://[fe80::1%25en0]",
    "https://0x7f.1",
    "https://2130706433",
    "https://127.0.0.1",
  ])
    assert.equal(inspectConnectorUrl(url).ok, false, url)
  const unicode = inspectConnectorUrl("https://bücher.example")
  assert.equal(unicode.ok, true)
  if (unicode.ok) assert.equal(unicode.host, "xn--bcher-kva.example")
  const trailing = inspectConnectorUrl("https://EXAMPLE.COM.")
  assert.equal(trailing.ok, true)
  if (trailing.ok) assert.equal(trailing.host, "example.com")
})

test("Allowlist und alle DNS-Antworten werden geprüft", async () => {
  const previous = process.env.CONNECTOR_ALLOW_HOSTS
  process.env.CONNECTOR_ALLOW_HOSTS = "xn--bcher-kva.example,example.com"
  const allowed = await resolveConnectorUrl(
    "https://bücher.example",
    async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
    ]
  )
  assert.equal(allowed.ok, true)
  const mixed = await resolveConnectorUrl("https://example.com", async () => [
    { address: "93.184.216.34", family: 4 },
    { address: "10.0.0.1", family: 4 },
  ])
  assert.equal(mixed.ok, false)
  const blocked = await resolveConnectorUrl(
    "https://other.example",
    async () => []
  )
  assert.equal(blocked.ok, false)
  if (previous === undefined) delete process.env.CONNECTOR_ALLOW_HOSTS
  else process.env.CONNECTOR_ALLOW_HOSTS = previous
})

test("public addresses remain permitted", () => {
  for (const ip of ["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"])
    assert.equal(privateAddress(ip), false, ip)
})
