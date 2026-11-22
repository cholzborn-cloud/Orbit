import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { SAFE_WRITE_SCRIPT } from "./sandbox-write.ts"

test("Neue Ausgabedateien bleiben im Ordner und überschreiben nichts", () => {
  const root = mkdtempSync(join(tmpdir(), "orbit-write-"))
  const outside = mkdtempSync(join(tmpdir(), "orbit-outside-"))
  const run = (path: string, content: string) => spawnSync("python3", ["-c", SAFE_WRITE_SCRIPT], {
    env: { ...process.env, ORBIT_WRITE_ROOT: root, ORBIT_WRITE_PATH: path, ORBIT_WRITE_DATA: Buffer.from(content).toString("base64") },
    encoding: "utf8",
  })
  try {
    assert.equal(run("output/bericht.txt", "Grüße").status, 0)
    assert.equal(readFileSync(join(root, "output/bericht.txt"), "utf8"), "Grüße")
    assert.notEqual(run("output/bericht.txt", "Überschreiben").status, 0)
    assert.equal(readFileSync(join(root, "output/bericht.txt"), "utf8"), "Grüße")
    writeFileSync(join(outside, "geheim.txt"), "unverändert")
    symlinkSync(outside, join(root, "output/link"))
    assert.notEqual(run("output/link/geheim.txt", "anders").status, 0)
    assert.equal(readFileSync(join(outside, "geheim.txt"), "utf8"), "unverändert")
    symlinkSync(join(outside, "geheim.txt"), join(root, "output/ziel.txt"))
    assert.notEqual(run("output/ziel.txt", "anders").status, 0)
    assert.equal(readFileSync(join(outside, "geheim.txt"), "utf8"), "unverändert")
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  }
})
