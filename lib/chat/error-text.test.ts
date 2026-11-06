// Start: node --test lib/chat/error-text.test.ts
import assert from "node:assert/strict"
import { test } from "node:test"

import { chatErrorText } from "./error-text.ts"

const text = (e: unknown) => chatErrorText(e).text

test("Dienst nicht erreichbar", () => {
  for (const raw of [
    "fetch failed: ECONNREFUSED",
    "connect ECONNREFUSED 127.0.0.1:4317",
    "Cannot connect to API: socket hang up",
    "Unable to connect to 127.0.0.1:4317",
  ])
    assert.match(text(new Error(raw)), /^Der Dienst ist nicht erreichbar/, raw)
})

test("Upstream-Fehler sind kein lokaler Dienstausfall", () => {
  for (const raw of [
    "Bad Gateway",
    "502 Service Unavailable",
    "HTTP 503",
    "Gateway returned an error",
  ])
    assert.equal(text(new Error(raw)), raw)
})

test("Unbestimmter fetch-Fehler bleibt Rohtext", () => {
  const raw = "Neon: fetch failed"
  assert.equal(text(new Error(raw)), raw)
})

test("Zahlen und Namen ohne HTTP-Kontext sind kein Statusfehler", () => {
  for (const raw of [
    "Datei 401.pdf nicht gefunden",
    "Fehler in Zeile 504",
    "Seite 429 fehlt",
    "Werkzeug forbidden_words fehlgeschlagen",
    "forbidden-words: Eingabe leer",
    "401.pdf nicht gefunden",
  ])
    assert.equal(text(new Error(raw)), raw)
})

test("HTTP-Status mit Kontext", () => {
  for (const raw of ["status 403", "HTTP 401", "Error: 401", "code=403"])
    assert.match(text(new Error(raw)), /Zugang abgelehnt/, raw)
  assert.match(text(new Error("status: 504")), /^Zeitüberschreitung/)
  assert.match(text(new Error("Error 429")), /Limit/)
  assert.match(text(new Error("403 Forbidden")), /Zugang abgelehnt/)
  assert.match(text(new Error("Forbidden")), /Zugang abgelehnt/)
})

test("maskierter Server-Fehler im Production-Build", () => {
  assert.match(
    text(
      new Error(
        "An error occurred in the Server Components render. The specific message is omitted in production builds to avoid leaking sensitive details."
      )
    ),
    /^Sitzung abgelaufen oder Server-Fehler\. Lade die Seite neu/
  )
})

test("unbekanntes Modell hat Vorrang vor einem Verbindungsfehler", () => {
  assert.match(
    text(new Error("Unbekanntes Modell gpt-9 (ECONNREFUSED)")),
    /^Das gewählte Modell ist nicht verfügbar/
  )
  assert.match(text("model_not_found"), /^Das gewählte Modell/)
})

test("Zeitüberschreitung", () => {
  for (const raw of [
    "Request timed out",
    "ETIMEDOUT",
    "Zeitüberschreitung",
    "504",
  ])
    assert.match(text(new Error(raw)), /^Zeitüberschreitung/, raw)
})

test("Zugang abgelehnt und Limit", () => {
  assert.match(text(new Error("401 Unauthorized")), /Zugang abgelehnt/)
  assert.match(text(new Error("429 Too Many Requests")), /Limit/)
})

test("überlasteter Anbieter hat eine eigene Meldung", () => {
  assert.match(
    text(new Error("Overloaded")),
    /^Der Anbieter ist gerade überlastet/
  )
  assert.match(
    text(new Error("429 overloaded_error")),
    /^Der Anbieter ist gerade überlastet/
  )
})

test("Chat in anderem Tab", () => {
  assert.match(
    text(new Error("This chat is active in another tab")),
    /anderen Tab/
  )
})

test("Browser ohne Netz", () => {
  assert.match(text(new TypeError("Failed to fetch")), /^Keine Verbindung/)
})

test("Rohtext bleibt als Detail, nur wenn übersetzt", () => {
  assert.equal(
    chatErrorText(new Error("fetch failed: ECONNREFUSED")).detail,
    "fetch failed: ECONNREFUSED"
  )
  assert.equal(
    chatErrorText(new Error("Orbi nicht gefunden")).detail,
    undefined
  )
})

test("unbekannter Text bleibt unverändert", () => {
  assert.equal(text(new Error("Orbi nicht gefunden")), "Orbi nicht gefunden")
  assert.equal(text("  Etwas ganz anderes  "), "Etwas ganz anderes")
})

test("leer oder kein Fehlerobjekt", () => {
  const fallback = "Die Antwort ist fehlgeschlagen."
  assert.equal(text(new Error("")), fallback)
  assert.equal(text(undefined), fallback)
  assert.equal(text({ message: "x" }), fallback)
})
