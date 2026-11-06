import assert from "node:assert/strict"
import { test } from "node:test"

import { Vault, memoryRunner } from "./vault.ts"

test("Wert wird in Stücken gespeichert und zurückgelesen", async () => {
  const runner = memoryRunner()
  const vault = new Vault(runner)
  const value = JSON.stringify({ token: "x".repeat(5000) })
  await vault.set("token:test:1", value)
  assert.equal(await vault.get("token:test:1"), value)
  assert.equal(runner.entries.get("token:test:1"), "4")
  assert.equal(await vault.has("token:test:1"), true)
})

test("Überschreiben mit kürzerem Wert räumt alte Stücke ab", async () => {
  const runner = memoryRunner()
  const vault = new Vault(runner)
  await vault.set("token:test:2", "y".repeat(5000))
  await vault.set("token:test:2", "kurz")
  assert.equal(await vault.get("token:test:2"), "kurz")
  assert.equal(runner.entries.has("token:test:2#1"), false)
})

test("Entfernen löscht Zähler und Stücke; fehlender Eintrag liefert null", async () => {
  const runner = memoryRunner()
  const vault = new Vault(runner)
  await vault.set("token:test:3", "z".repeat(4500))
  await vault.remove("token:test:3")
  assert.equal(runner.entries.size, 0)
  assert.equal(await vault.get("token:test:3"), null)
  assert.equal(await vault.has("token:test:3"), false)
})

test("ungültige Namen werden abgewiesen", async () => {
  const vault = new Vault(memoryRunner())
  await assert.rejects(() => vault.set("Gross Name", "x"))
  await assert.rejects(() => vault.get("a b"))
})
