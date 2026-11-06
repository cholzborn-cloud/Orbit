import assert from "node:assert/strict"
import { test } from "node:test"

import { Vault, memoryRunner } from "./vault.ts"
import {
  dropOAuth,
  oauthAccount,
  oauthPendingAccount,
  pendingOAuthStore,
  promotePendingOAuth,
  vaultOAuthStore,
} from "./oauth-vault-store.ts"

test("Speichern geht nur in den Schlüsselbund; alter Wert wird als Rückfall gelesen", async () => {
  const runner = memoryRunner()
  const vault = new Vault(runner)
  let legacyWrites = 0
  const legacy = { load: async () => "alt", save: async () => { legacyWrites++ } }
  const store = vaultOAuthStore(vault, "c1", legacy)
  assert.equal(await store.load(), "alt")
  await store.save("neu")
  assert.equal(await store.load(), "neu")
  assert.equal(legacyWrites, 0)
})

test("laufende Anmeldung überschreibt eine bestehende Verbindung nicht", async () => {
  const vault = new Vault(memoryRunner())
  await vault.set(oauthAccount("c2"), "verbunden")
  const pending = pendingOAuthStore(vault, "c2")
  await pending.save(null)
  await pending.save("zwischenstand")
  assert.equal(await vault.get(oauthAccount("c2")), "verbunden")
  await promotePendingOAuth(vault, "c2")
  assert.equal(await vault.get(oauthAccount("c2")), "zwischenstand")
  assert.equal(await vault.has(oauthPendingAccount("c2")), false)
})

test("Abbruch räumt nur den Zwischenstand, Trennen räumt alles", async () => {
  const vault = new Vault(memoryRunner())
  await vault.set(oauthAccount("c3"), "v")
  await vault.set(oauthPendingAccount("c3"), "p")
  await assert.rejects(() => promotePendingOAuth(new Vault(memoryRunner()), "c3"))
  await dropOAuth(vault, "c3")
  assert.equal(await vault.has(oauthAccount("c3")), false)
  assert.equal(await vault.has(oauthPendingAccount("c3")), false)
})
