import assert from "node:assert/strict"
import test from "node:test"

import { isSilent } from "./group-round.ts"

const msg = (text: string) => ({ parts: [{ type: "step-start" as const }, { type: "text" as const, text }] })

test("Gruppe: „nichts Neues“-Antworten zählen als Schweigen, echte Beiträge nicht (09.11.2026)", () => {
  for (const text of ["Ich habe dazu nichts Neues beizutragen, meine Antworten stehen oben schon.", "Von mir nichts weiter.", "Dem ist nichts hinzuzufügen.", ""])
    assert.equal(isSilent(msg(text) as never), true, text)
  for (const text of ["👍", "😊🙏"]) assert.equal(isSilent(msg(text) as never), true, text)
  for (const text of ["Der Termin steht schon im Kalender.", "Das ist bereits beantwortet worden, die Rechnung ist bezahlt.", "Meine Lieblingsfarbe ist Grün.", "Ich ergänze: Die Datei fehlt noch, ich lege sie gleich an und melde mich dann wieder bei dir mit dem Ergebnis."])
    assert.equal(isSilent(msg(text) as never), false, text)
})
