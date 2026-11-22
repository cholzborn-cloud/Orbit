import assert from "node:assert/strict"
import test from "node:test"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { parseClaudeCliUsage, readClaudeCliUsage } from "./claude-cli.ts"

test("Claude-Dialog liefert zwei Fenster mit lokalen Rücksetzzeiten", () => {
  const now = Date.parse("2026-11-03T17:00:00Z")
  const screen = "Current session\n0% 0% used\nResets 3:30am (Europe/Vienna)\nCurrent week (all models)\n49% 49% used\nResets Nov 8 at 12pm (Europe/Vienna)\nCurrent week (Sonnet only)\n96% used"
  const result = parseClaudeCliUsage(screen, now)
  assert.equal(result.status, "ok")
  assert.deepEqual(result.accounts[0]?.windows, [
    { name: "5h", used: 0, resetAt: Date.parse("2026-11-04T02:30:00Z") },
    { name: "7d", used: 0.49, resetAt: Date.parse("2026-11-08T11:00:00Z") },
  ])
})

test("Unvollständige, ungültige und volle Anzeigen werden nicht als normal ausgegeben", () => {
  const now = Date.parse("2026-11-03T17:00:00Z")
  assert.equal(parseClaudeCliUsage("Current session\n50% used\nResets morgen", now).status, "error")
  assert.equal(parseClaudeCliUsage("Current session\n101% used\nResets 3pm (UTC)", now).status, "error")
  assert.equal(parseClaudeCliUsage("Current session\n100% used\nResets 8pm (UTC)", now).status, "limit")
})

test("Lokaler Terminal-Dialog wird ohne echtes Konto abgefragt", async () => {
  const before = process.env.ORBIT_CLAUDE_BIN
  process.env.ORBIT_CLAUDE_BIN = fileURLToPath(new URL("./fixtures/claude-cli-mock.sh", import.meta.url))
  try {
    const result = await readClaudeCliUsage(true)
    assert.equal(result.status, "ok")
    assert.deepEqual(result.accounts[0]?.windows.map(({ name, used }) => [name, used]), [["5h", 0.2], ["7d", 0.4]])
  } finally {
    if (before === undefined) delete process.env.ORBIT_CLAUDE_BIN
    else process.env.ORBIT_CLAUDE_BIN = before
  }
})

test("Teilantwort mit vollem Fenster bleibt erhalten; fehlgeschlagenes Aktualisieren leert den Cache", async () => {
  const temp = mkdtempSync(join(tmpdir(), "orbit-claude-test-"))
  const oldTmp = process.env.TMPDIR, oldBin = process.env.ORBIT_CLAUDE_BIN
  process.env.TMPDIR = temp
  process.env.ORBIT_CLAUDE_BIN = fileURLToPath(new URL("./fixtures/claude-cli-mock.sh", import.meta.url))
  try {
    assert.equal((await readClaudeCliUsage(true)).status, "ok")
    writeFileSync(join(temp, "orbit-claude-partial"), "")
    const partial = await readClaudeCliUsage(true)
    assert.equal(partial.status, "limit")
    assert.equal(partial.accounts[0]?.windows[0]?.used, 1)
    assert.ok(partial.note)
    process.env.ORBIT_CLAUDE_BIN = join(temp, "fehlt")
    assert.equal((await readClaudeCliUsage()).status, "error")
  } finally {
    if (oldTmp === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = oldTmp
    if (oldBin === undefined) delete process.env.ORBIT_CLAUDE_BIN; else process.env.ORBIT_CLAUDE_BIN = oldBin
  }
})

test("Überlauf beendet auch den gestarteten Kindprozess", async () => {
  const temp = mkdtempSync(join(tmpdir(), "orbit-claude-test-"))
  const oldTmp = process.env.TMPDIR, oldBin = process.env.ORBIT_CLAUDE_BIN
  process.env.TMPDIR = temp
  process.env.ORBIT_CLAUDE_BIN = fileURLToPath(new URL("./fixtures/claude-cli-mock.sh", import.meta.url))
  writeFileSync(join(temp, "orbit-claude-overflow"), "")
  try {
    assert.equal((await readClaudeCliUsage(true)).status, "error")
    const pid = Number(readFileSync(join(temp, "orbit-claude-child.pid"), "utf8"))
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" })
  } finally {
    if (oldTmp === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = oldTmp
    if (oldBin === undefined) delete process.env.ORBIT_CLAUDE_BIN; else process.env.ORBIT_CLAUDE_BIN = oldBin
  }
})
