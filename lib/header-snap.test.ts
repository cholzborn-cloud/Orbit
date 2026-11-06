// Start: node --test lib/header-snap.test.ts
import assert from "node:assert/strict"
import { test } from "node:test"

import { headerProgress, snapTarget } from "./header-snap.ts"

const D = 96
const MAX = 2000

test("Richtung entscheidet", () => {
  assert.equal(snapTarget(0.3 * D, 1, MAX, D), D)
  assert.equal(snapTarget(0.7 * D, -1, MAX, D), 0)
})

test("ohne Richtung: Hälfte entscheidet", () => {
  assert.equal(snapTarget(0.3 * D, 0, MAX, D), 0)
  assert.equal(snapTarget(0.5 * D, 0, MAX, D), D)
  assert.equal(snapTarget(0.7 * D, 0, MAX, D), D)
})

test("Ruhepunkte und normales Scrollen bleiben", () => {
  assert.equal(snapTarget(0, 1, MAX, D), null)
  assert.equal(snapTarget(D, -1, MAX, D), null)
  assert.equal(snapTarget(500, 0, MAX, D), null)
})

test("kurzer Inhalt: nie einrasten", () => {
  assert.equal(snapTarget(30, 0, 30, D), null)
})

test("Fortschritt geklemmt", () => {
  assert.equal(headerProgress(-10, D), 0)
  assert.equal(headerProgress(48, D), 0.5)
  assert.equal(headerProgress(500, D), 1)
})
