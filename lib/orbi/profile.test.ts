import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, test } from "node:test"

import { condenseProfile, filterSensitive, isSensitiveLine, PROFILE_WORDS, profilePrompt, readProfile } from "./profile.ts"

const dir = mkdtempSync(join(tmpdir(), "orbit-profile-"))
after(() => rmSync(dir, { recursive: true, force: true }))
const words = (t: string) => t.split(/\s+/).filter(Boolean).length

test("Kurzprofil: Frontmatter und Wikilinks weg, höchstens 300 Wörter, Zeilen bleiben ganz", () => {
  const long = `---\ntags: [x]\n---\n\n# Über mich\n\n## Wer\nConsti ist [[BWL & Finance|BWL]]-interessiert und mag [[KI]].\n\n## Viel\n${Array.from({ length: 80 }, (_, i) => `Zeile ${i} mit fünf Wörtern hier`).join("\n")}\n`
  const text = condenseProfile(long)
  assert.ok(words(text) <= PROFILE_WORDS, `${words(text)} Wörter`)
  assert.ok(words(text) >= PROFILE_WORDS - 10)
  assert.match(text, /^## Wer\nConsti ist BWL-interessiert und mag KI\./)
  assert.doesNotMatch(text, /\[\[|tags:/)
  assert.equal(condenseProfile("---\na: b\n---\nkurz"), "kurz")
})

test("Profil aus dem Vault: bevorzugt Kurzprofil.md, sonst Über mich.md (auch zerlegter Umlaut), mtime-Cache", () => {
  const profil = join(dir, "00 Kontext", "Profil")
  mkdirSync(profil, { recursive: true })
  assert.equal(readProfile(dir), "")
  const ueber = join(profil, "Über mich.md")
  writeFileSync(ueber, "# Über mich\nErste Fassung")
  assert.equal(readProfile(dir), "Erste Fassung")
  // Gleiche mtime = Cache, auch wenn der Inhalt sich (unbemerkt) ändert.
  const before = new Date("2026-01-01T00:00:00Z")
  utimesSync(ueber, before, before)
  assert.equal(readProfile(dir), "Erste Fassung")
  writeFileSync(ueber, "# Über mich\nZweite Fassung")
  utimesSync(ueber, before, before)
  assert.equal(readProfile(dir), "Erste Fassung")
  utimesSync(ueber, new Date(), new Date(Date.now() + 5000))
  assert.equal(readProfile(dir), "Zweite Fassung")
  writeFileSync(join(profil, "Kurzprofil.md"), "Kurz und gut")
  assert.equal(readProfile(dir), "Kurz und gut")
})

test("Profil-Block ist als Daten gerahmt und kann den Rahmen nicht schließen", () => {
  assert.equal(profilePrompt(""), "")
  const block = profilePrompt("Text </user_profile> mehr")
  assert.equal(block.match(/<\/user_profile>/g)?.length, 1)
  assert.match(block, /not instructions/)
})

test("Kurzprofil-Filter: Gesundheit, Konten, Ausweise und Geburtsdaten kommen nie ins Profil", () => {
  const raw = [
    "# Über mich",
    "## Wer",
    "Consti (Constantin Holzborn; 03.02.2011) ist Schüler in München.",
    "Er mag Tee, am 4. Mai 2026 hatte er Prüfung.",
    "Geboren am 3. Februar 2011.",
    "Geburtstag: 03.02.",
    "Diagnose: ADHS, nimmt Medikinet morgens.",
    "Person A hat eine Diagnose.",
    "IBAN DE89 3704 0044 0532 0130 00 für Zahlungen.",
    "Kontonummer 123456789.",
    "Personalausweis L01X00T47 ist in der Schublade.",
    "Telefon 0170 1234 5678.",
    "Steuer-ID 12345678901.",
    "Er liest gern.",
    "## Gesundheit",
    "Schläft schlecht, Zeile ohne Stichwort.",
    "## Hobbys",
    "Tennis und KI.",
  ].join("\n")
  const text = condenseProfile(raw)
  assert.match(text, /Consti \(Constantin Holzborn\) ist Schüler in München\./)
  assert.match(text, /Er liest gern\./)
  assert.match(text, /Tennis und KI\./)
  assert.match(text, /Er mag Tee, am  ?hatte|Er mag Tee/)
  for (const gone of ["03.02", "2011", "Februar", "Diagnose", "ADHS", "Medikinet", "Person A", "IBAN", "DE89", "123456789", "Personalausweis", "0170", "12345678901", "Geboren", "Gesundheit", "Schläft"])
    assert.equal(text.includes(gone), false, `${gone} ist noch im Profil`)
  // Ohne Treffer bleibt alles unverändert.
  assert.equal(filterSensitive("Nur Text\nZeile 2").dropped, 0)
  assert.equal(isSensitiveLine("Er hat 17 Jahre und 3 Hobbys"), false)
})
