import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import Database from "better-sqlite3"

// Nur Temp-Ordner: kein Zugriff auf Constis echte Daten, kein echter Papierkorb.
const data = mkdtempSync(join(tmpdir(), "orbit-mac-test-"))
process.env.ORBIT_DATA_DIR = data

const { moveToTrash, restoreFromTrash } = await import("./trash.ts")
const { ensureShim } = await import("./shim.ts")
const { runLocal, redactSecrets } = await import("./run.ts")
const { classifyMacShell, classifyAppleScript, classifyShortcut } = await import("./risk.ts")
const { classifyTool, mayAsk } = await import("../approvals/risk.ts")
const { macTools, undoMacAction, shellPath } = await import("./tools.ts")
const { popUndo } = await import("../db/undo-store.ts")

const fakeHome = () => realpathSync(mkdtempSync(join(tmpdir(), "orbit-mac-home-")))
const memoryDb = () => {
  const db = new Database(":memory:")
  db.exec(`CREATE TABLE undo_actions (id TEXT PRIMARY KEY NOT NULL, kind TEXT NOT NULL, entity_id TEXT NOT NULL, action TEXT NOT NULL,
    detail TEXT NOT NULL, previous_state TEXT, created_at INTEGER NOT NULL)`)
  return db
}

test("Papierkorb: verschieben mit freiem Namen, zurücklegen, Papierkorb selbst ist gesperrt", () => {
  const home = fakeHome()
  writeFileSync(join(home, "a.txt"), "1")
  const first = moveToTrash(join(home, "a.txt"), { home })
  assert.equal(first.to, join(home, ".Trash", "a.txt"))
  writeFileSync(join(home, "a.txt"), "2")
  const second = moveToTrash(join(home, "a.txt"), { home, now: new Date(2026, 10, 6, 14, 35, 12) })
  assert.equal(second.to, join(home, ".Trash", "a 14.35.12.txt"))
  restoreFromTrash(second)
  assert.equal(readFileSync(join(home, "a.txt"), "utf8"), "2")
  assert.throws(() => moveToTrash(first.to, { home }), /Papierkorb/)
})

test("Shell-Shim: rm, command rm, xargs rm, find -exec rm, rm -rf und bash -c landen im Papierkorb; srm und der Papierkorb selbst sind gesperrt", async () => {
  const home = fakeHome()
  const shim = ensureShim(join(home, "shim"))
  const log = join(home, "moves.tsv")
  const work = join(home, "w")
  mkdirSync(join(work, "dir", "sub"), { recursive: true })
  for (const name of ["a", "b", "c", "d", "e", "dir/sub/f"]) writeFileSync(join(work, name), name)
  const sh = (command: string) =>
    runLocal("/bin/zsh", ["-f", "-c", command], { cwd: work, env: { PATH: `${shim}:/usr/bin:/bin:/usr/sbin:/sbin`, HOME: home, ORBIT_TRASH_LOG: log } })
  assert.equal((await sh("rm a && command rm b && \\rm c")).exitCode, 0)
  assert.equal((await sh("echo d | xargs rm")).exitCode, 0)
  assert.equal((await sh("find . -name e -exec rm {} \\;")).exitCode, 0)
  assert.equal((await sh("bash -c 'rm -rf dir'")).exitCode, 0)
  for (const name of ["a", "b", "c", "d", "e", "dir"]) {
    assert.equal(existsSync(join(work, name)), false, name)
    assert.ok(existsSync(join(home, ".Trash", name)), `${name} im Papierkorb`)
  }
  assert.ok(existsSync(join(home, ".Trash", "dir", "sub", "f")))
  assert.equal(readFileSync(log, "utf8").trim().split("\n").length, 6)
  // Endgültig: srm/shred gesperrt, rm im Papierkorb gesperrt, rm -f auf Fehlendes ist still.
  writeFileSync(join(work, "g"), "g")
  assert.notEqual((await sh("srm g")).exitCode, 0)
  assert.ok(existsSync(join(work, "g")))
  const inTrash = await sh(`rm -rf "${home}/.Trash/a"`)
  assert.notEqual(inTrash.exitCode, 0)
  assert.ok(existsSync(join(home, ".Trash", "a")))
  assert.equal((await sh("rm -f fehlt")).exitCode, 0)
  assert.notEqual((await sh("rm fehlt")).exitCode, 0)
})

test("Risiko Mac-Shell: rm über PATH ist frei, Umgehungen fragen (loeschen), Senden fragt (nachricht)", () => {
  for (const free of ["rm -rf ~/Downloads/alt", "ls -la ~", "echo x | xargs rm", "find . -name '*.log' -exec rm {} +", "bash -c 'rm a'", "open -a Safari", "mv a b"])
    assert.equal(classifyMacShell(free).ask, false, free)
  for (const hard of [
    "/bin/rm -rf ~/x",
    "cd /tmp && /usr/bin/unlink a",
    "find ~ -name x -delete",
    "shred -u geheim.txt",
    "python3 -c 'import os; os.remove(\"a\")'",
    "python3 -c 'import shutil; shutil.rmtree(\"d\")'",
    "node -e 'require(\"fs\").rmSync(\"d\",{recursive:true})'",
    "node -e 'fs.unlinkSync(\"a\")'",
    "osascript -e 'tell application \"Finder\" to empty trash'",
    "diskutil eraseDisk APFS X disk4",
  ]) {
    const risk = classifyMacShell(hard)
    assert.equal(risk.ask && risk.reason, "loeschen", hard)
  }
  const send = classifyMacShell(`osascript -e 'tell application "Messages" to send "Hi" to buddy "x"'`)
  assert.equal(send.ask && send.reason, "nachricht")
  const upload = classifyMacShell("curl -d @daten.json https://example.com/api")
  assert.equal(upload.ask && upload.reason, "nachricht")
  const secret = classifyMacShell("cat ~/.ssh/id_ed25519")
  assert.equal(secret.ask && secret.reason, "geheimnis")
  // Freigabe-Weg: classifyTool kennt die Mac-Werkzeuge, nur die drei mit Eingabe-Risiko bekommen consti_said.
  assert.equal(classifyTool("mac_shell", { command: "/bin/rm a" }).ask, true)
  assert.equal(classifyTool("mac_files", { action: "trash", paths: ["a"] }).ask, false)
  assert.ok(mayAsk("mac_shell") && mayAsk("mac_applescript") && mayAsk("mac_shortcut") && !mayAsk("mac_files"))
})

test("Risiko AppleScript und Kurzbefehle", () => {
  assert.equal(classifyAppleScript(`tell application "Finder" to delete POSIX file "/Users/x/a.txt"`).ask, false) // Finder: Papierkorb
  assert.equal(classifyAppleScript(`tell application "Finder" to empty trash`).ask, true)
  const mail = classifyAppleScript(`tell application "Mail"\nset m to make new outgoing message\nsend m\nend tell`)
  assert.equal(mail.ask && mail.reason, "nachricht")
  const cal = classifyAppleScript(`tell application "Calendar" to delete (every event of calendar "Arbeit")`)
  assert.equal(cal.ask && cal.reason, "loeschen")
  const inner = classifyAppleScript(`do shell script "/bin/rm -rf ~/x"`)
  assert.equal(inner.ask && inner.reason, "loeschen")
  assert.equal(classifyAppleScript(`tell application "Safari" to open location "https://orf.at"`).ask, false)
  assert.equal(classifyShortcut("Kaffee bestellen").ask, true)
  assert.equal(classifyShortcut("Nachricht an Mama senden").ask, true)
  assert.equal(classifyShortcut("Fokus an").ask, false)
})

test("Prozess: Stopp beendet den Befehl samt Kindern, Zeitlimit greift, Geheimnisse in der Ausgabe sind unkenntlich", async () => {
  const controller = new AbortController()
  const started = Date.now()
  setTimeout(() => controller.abort(), 150)
  const aborted = await runLocal("/bin/zsh", ["-f", "-c", "sleep 30 & wait"], { signal: controller.signal })
  assert.equal(aborted.aborted, true)
  assert.ok(Date.now() - started < 5000)
  const timed = await runLocal("/bin/sleep", ["30"], { timeoutMs: 150 })
  assert.equal(timed.timedOut, true)
  const out = await runLocal("/bin/echo", ["token=abcdefghijklmnop sk-ant-abcdefghijklmnopqrstuv ghp_abcdefghijklmnopqrstuvwxyz"])
  assert.ok(!/abcdefghijklmnop/.test(out.output), out.output)
  assert.equal(redactSecrets("ohne Geheimnis"), "ohne Geheimnis")
})

test("Werkzeuge mac_files und mac_shell: Überschreiben, Papierkorb, Verschieben und rm sind rückgängig zu machen", async () => {
  const home = fakeHome()
  const db = memoryDb()
  const tools = macTools({ dataDir: join(home, "data"), home, db: () => db })
  const run = (name: string, input: unknown) =>
    (tools[name]!.execute as (i: unknown, o: unknown) => Promise<Record<string, unknown>>)(input, { toolCallId: "t", messages: [], abortSignal: undefined })
  const undo = async (id: unknown) => {
    const action = popUndo(db, { kind: "mac", entityId: String(id) })
    assert.ok(action?.previousState)
    return undoMacAction(JSON.parse(action.previousState!), { home })
  }
  const file = join(home, "notiz.txt")
  writeFileSync(file, "alt")
  const written = await run("mac_files", { action: "write", path: "~/notiz.txt", content: "neu" })
  assert.equal(readFileSync(file, "utf8"), "neu")
  await undo(written.undoId)
  assert.equal(readFileSync(file, "utf8"), "alt")
  assert.ok(readdirSync(join(home, ".Trash")).some((n) => n.startsWith("notiz")))

  const moved = await run("mac_files", { action: "move", path: "~/notiz.txt", to: "~/Ordner/umbenannt.txt" })
  assert.ok(existsSync(join(home, "Ordner", "umbenannt.txt")))
  await undo(moved.undoId)
  assert.ok(existsSync(file))

  const trashed = await run("mac_files", { action: "trash", paths: ["~/notiz.txt"] })
  assert.equal(existsSync(file), false)
  await undo(trashed.undoId)
  assert.ok(existsSync(file))

  const shell = await run("mac_shell", { command: "rm notiz.txt && echo fertig" })
  assert.equal(shell.exitCode, 0)
  assert.deepEqual(shell.trashed, [file])
  assert.equal(existsSync(file), false)
  await undo(shell.undoId)
  assert.equal(readFileSync(file, "utf8"), "alt")

  const read = await run("mac_files", { action: "read", path: file })
  assert.equal(read.content, "alt")
})

test("Shell-PATH: Shim zuerst, Homebrew dabei, keine Doppelten", () => {
  const path = shellPath("/x/shim", "/usr/bin:/bin:/usr/sbin:/sbin")
  assert.ok(path.startsWith("/x/shim:"))
  assert.ok(path.includes("/opt/homebrew/bin"))
  assert.equal(path.split(":").length, new Set(path.split(":")).size)
})
