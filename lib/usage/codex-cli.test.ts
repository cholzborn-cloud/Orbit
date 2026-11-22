import assert from "node:assert/strict"
import test from "node:test"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { parseCodexCliUsage, readCodexCliUsage } from "./codex-cli.ts"

test("Codex-CLI: Nutzungsfenster werden ohne Kontodaten übernommen", () => {
  const result = parseCodexCliUsage({ accountId: "nicht-anzeigen", rateLimits: { primary: { usedPercent: 50, resetsAt: 2000, windowDurationMins: 300 }, secondary: { usedPercent: 100, resetsAt: 4000, windowDurationMins: 10080 } } })
  assert.equal(result.status, "limit")
  assert.deepEqual(result.accounts[0]?.windows, [{ name: "5h", used: 0.5, resetAt: 2_000_000 }, { name: "7d", used: 1, resetAt: 4_000_000 }])
  assert.doesNotMatch(JSON.stringify(result), /nicht-anzeigen/)
})

test("Ungültige, einzelne und doppelte Fenster ergeben kein ok", () => {
  const window = { usedPercent: 20, resetsAt: 30, windowDurationMins: 300 }
  assert.equal(parseCodexCliUsage({ rateLimits: { primary: window } }).status, "error")
  assert.equal(parseCodexCliUsage({ rateLimits: { primary: window, secondary: window } }).status, "error")
  for (const value of [-1, 101]) {
    const result = parseCodexCliUsage({ rateLimits: { primary: { ...window, usedPercent: value }, secondary: { ...window, windowDurationMins: 10080 } } })
    assert.equal(result.status, "error")
    assert.equal(result.accounts[0]?.windows.length, 1)
  }
  const limited = parseCodexCliUsage({ rateLimits: { primary: { ...window, usedPercent: 100 } } })
  assert.equal(limited.status, "limit")
  assert.ok(limited.note)
})

test("Codex-Ausgabe ohne Zeilenende ist begrenzt und Kindprozess wird beendet", async () => {
  const temp = mkdtempSync(join(tmpdir(), "orbit-codex-test-"))
  const oldTmp = process.env.TMPDIR, oldBin = process.env.ORBIT_CODEX_BIN
  process.env.TMPDIR = temp
  process.env.ORBIT_CODEX_BIN = fileURLToPath(new URL("./fixtures/codex-cli-mock.sh", import.meta.url))
  writeFileSync(join(temp, "orbit-codex-overflow"), "")
  try {
    assert.equal((await readCodexCliUsage()).status, "error")
    const pid = Number(readFileSync(join(temp, "orbit-codex-child.pid"), "utf8"))
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" })
  } finally {
    if (oldTmp === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = oldTmp
    if (oldBin === undefined) delete process.env.ORBIT_CODEX_BIN; else process.env.ORBIT_CODEX_BIN = oldBin
  }
})

test("Codex-CLI: fehlende oder unbekannte Fenster werden nicht erfunden", () => {
  assert.equal(parseCodexCliUsage(null).status, "error")
  assert.equal(parseCodexCliUsage({ rateLimits: { primary: { usedPercent: 20, resetsAt: 30, windowDurationMins: 42 } } }).status, "error")
  assert.equal(parseCodexCliUsage({ ordinaryUsageAllowed: false, rateLimits: {} }).status, "limit")
})
