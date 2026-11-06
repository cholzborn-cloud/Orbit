import assert from "node:assert/strict"
import fs from "node:fs"
import { syncBuiltinESMExports } from "node:module"
import test from "node:test"

import { loadSecrets } from "./secrets"

test("Schlüsseldatei: liest Schlüssel, Kommentare und leere Werte zählen nicht, gesetzte Variablen gewinnen", (t) => {
  t.mock.method(fs, "statSync", () => ({ isFile: () => true, mode: 0o600, uid: process.getuid!() }) as never)
  t.mock.method(fs, "readFileSync", () => '# Kommentar\nA_KEY=eins\nexport B_KEY="zwei"\nLEER=\nSCHON=neu\nkaputt zeile\n')
  syncBuiltinESMExports()
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports() })
  const env: NodeJS.ProcessEnv = { SCHON: "da" }
  assert.deepEqual(loadSecrets("/synthetic", env), { loaded: 2 })
  assert.equal(env.A_KEY, "eins")
  assert.equal(env.B_KEY, "zwei")
  assert.equal(env.SCHON, "da")
  assert.equal(env.LEER, undefined)
})

test("Schlüsseldatei: offene Rechte werden nicht gelesen, fehlende Datei ist in Ordnung", (t) => {
  const stat = t.mock.method(fs, "statSync", () => ({ isFile: () => true, mode: 0o644, uid: process.getuid!() }) as never)
  const read = t.mock.method(fs, "readFileSync", () => { throw new Error("Datei darf nicht gelesen werden") })
  syncBuiltinESMExports()
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports() })
  const env: NodeJS.ProcessEnv = {}
  const open = loadSecrets("/synthetic", env)
  assert.equal(open.loaded, 0)
  assert.match(open.warning ?? "", /offene Rechte/)
  assert.equal(env.A_KEY, undefined)
  assert.equal(read.mock.callCount(), 0)
  stat.mock.mockImplementation(() => { throw new Error("fehlt") })
  assert.deepEqual(loadSecrets("/synthetic", env), { loaded: 0 })
})
