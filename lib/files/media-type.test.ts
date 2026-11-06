import assert from "node:assert/strict"
import test from "node:test"
import { mediaTypeOf } from "./media-type.ts"

test("Dateiausgabe erkennt Office-Formate und kennzeichnet unbekannte Dateien als binär", () => {
  assert.equal(mediaTypeOf("Bericht.DOCX"), "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
  assert.equal(mediaTypeOf("Tabelle.xlsx"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
  assert.equal(mediaTypeOf("Vortrag.pptx"), "application/vnd.openxmlformats-officedocument.presentationml.presentation")
  assert.equal(mediaTypeOf("unbekannt"), "application/octet-stream")
  assert.equal(mediaTypeOf("A.pdf"), "application/pdf")
})
