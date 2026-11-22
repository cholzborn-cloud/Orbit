import { fileURLToPath } from "node:url"
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { createServer as createHttpServer } from "node:http"
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import {
  createBrainTools,
  extractSection,
  tokenMatches,
  validateRelativePath,
  validateWrite,
} from "./brain.ts"

test("Pfade lehnen alle Traversal-Varianten ab", () => {
  for (const path of [
    "../x.md",
    "a/../x.md",
    "/tmp/x.md",
    "C:/tmp/x.md",
    "~/x.md",
    "a\\x.md",
    "a\0x.md",
    "./x.md",
  ]) {
    assert.throws(() => validateRelativePath(path))
  }
  assert.equal(validateRelativePath("01 Inbox/Notiz.md"), "01 Inbox/Notiz.md")
})

test("Ganzes Brain beschreibbar, Kopfstück und Pfadschutz bleiben", () => {
  const valid =
    "---\ntags: []\nstatus: inbox\ndate: 2026-10-17\nherkunft: Consti, 2026-10-17\n---\n"
  assert.throws(
    () => validateWrite("01 Inbox/x.md", "# Ohne Kopfstück", "create"),
    /Kopfstück/
  )
  for (const path of [
    "01 Inbox/x.md",
    "03 Bereiche/x.md",
    "04 Ressourcen/Fähigkeiten/x/SKILL.md",
    "04 Ressourcen/KI-Gedächtnis/x.md",
    "02 Projekte/AGENTS.md",
    "06 Archiv/x.md",
  ])
    assert.doesNotThrow(() => validateWrite(path, valid, "create"), path)
  for (const path of ["01 Inbox/.hidden.md", "01 Inbox/．．/x.md", "../x.md"])
    assert.throws(() => validateWrite(path, valid, "create"))
  assert.throws(() =>
    validateWrite(
      "01 Inbox/x.md",
      "---\ntags: []\nstatus: ok\ndate: bald\nherkunft: Test\n---",
      "create"
    )
  )
})

test("create ist exklusiv, append und replace ändern, Löschen archiviert", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "orbit-brain-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  for (const folder of ["00 Kontext", "03 Bereiche", "06 Archiv"])
    await mkdir(path.join(root, folder), { recursive: true })
  const note =
    "---\ntags: []\nstatus: inbox\ndate: 2026-10-17\nherkunft: Test, 2026-10-17\n---\n# Stichwort\nInhalt eins\n\n## Weiter\nKindinhalt\n\n# Ende\nEndinhalt"
  const tools = createBrainTools(root)
  assert.equal(
    extractSection(note, "Weiter").trimEnd(),
    "## Weiter\nKindinhalt"
  )
  const file = "03 Bereiche/Notiz.md"
  await assert.rejects(tools.brain_write(file, "x", "append"), /existiert nicht/)
  await assert.rejects(tools.brain_write(file, "x", "replace"), /existiert nicht/)
  await tools.brain_write(file, note, "create")
  await assert.rejects(tools.brain_write(file, note, "create"), /existiert/)
  await tools.brain_write(file, "\nErgänzung", "append")
  assert.match(await readFile(path.join(root, file), "utf8"), /Ergänzung$/)
  await tools.brain_write(file, "Neu", "replace")
  assert.equal(await readFile(path.join(root, file), "utf8"), "Neu")
  assert.equal((await tools.brain_search("Neu")).length, 1)
  assert.match(await tools.brain_move(file, "03 Bereiche/Umbenannt.md"), /Verschoben/)
  await writeFile(path.join(root, "06 Archiv/03 Bereiche.md"), "")
  await mkdir(path.join(root, "06 Archiv/03 Bereiche"), { recursive: true })
  await writeFile(path.join(root, "06 Archiv/03 Bereiche/Umbenannt.md"), "alt")
  // Archivieren überschreibt nie: zweites Exemplar bekommt einen Zeitstempel.
  assert.match(await tools.brain_move("03 Bereiche/Umbenannt.md"), /Archiviert in 06 Archiv\/03 Bereiche\/Umbenannt .+\.md/)
  await assert.rejects(readFile(path.join(root, "03 Bereiche/Umbenannt.md")))
  assert.equal(await readFile(path.join(root, "06 Archiv/03 Bereiche/Umbenannt.md"), "utf8"), "alt")
  await assert.rejects(tools.brain_move("00 Kontext/fehlt.md"))
  await assert.rejects(tools.brain_move("06 Archiv/03 Bereiche/Umbenannt.md", "../raus.md"))
})

test("Symlink im Vault ist kein Schreibziel und Root-Karte ist lesbar", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "orbit-brain-safe-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(path.join(root, "01 Inbox"), { recursive: true })
  await mkdir(path.join(root, "04 Ressourcen/Design"), { recursive: true })
  await writeFile(path.join(root, "Start.md"), "Startinhalt")
  await symlink(
    path.join(root, "04 Ressourcen/Design"),
    path.join(root, "01 Inbox/Umleitung")
  )
  const tools = createBrainTools(root)
  await assert.rejects(
    tools.brain_write("01 Inbox/Umleitung/x.md", "x", "create")
  )
  assert.equal(await tools.brain_read("Start.md"), "Startinhalt")
  assert.equal((await tools.brain_search("Startinhalt")).length, 1)
})

test("Symlink-Ausbruch wird bei Lesen und Schreiben abgewehrt", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "orbit-brain-root-"))
  const outside = await mkdtemp(path.join(os.tmpdir(), "orbit-brain-out-"))
  t.after(async () => {
    await rm(root, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  })
  await mkdir(path.join(root, "01 Inbox"), { recursive: true })
  await writeFile(path.join(outside, "Secret.md"), "secret")
  await symlink(outside, path.join(root, "01 Inbox", "Ausbruch"))
  const tools = createBrainTools(root)
  await assert.rejects(tools.brain_read("01 Inbox/Ausbruch/Secret.md"))
  await assert.rejects(
    tools.brain_write("01 Inbox/Ausbruch/Neue.md", "x", "append")
  )
  await assert.rejects(tools.brain_move("01 Inbox/Ausbruch/Secret.md"))
})

test("Bearer-Prüfung akzeptiert nur exakten Token", () => {
  assert.equal(tokenMatches("abc", "Bearer abc"), true)
  assert.equal(tokenMatches("abc", "abc"), false)
  assert.equal(tokenMatches("abc", "Bearer abcd"), false)
  assert.equal(tokenMatches("abc", undefined), false)
})

test("HTTP stateless accepts sequential initialize, list, and call", async (t) => {
  const probe = createHttpServer()
  try {
    await new Promise<void>((resolve, reject) => {
      probe.once("error", reject)
      probe.listen(0, "127.0.0.1", resolve)
    })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EPERM") {
      t.skip(
        "Sandbox verhindert listen; Koordinator muss HTTP-Integration ausführen."
      )
      return
    }
    throw error
  }
  const port = (probe.address() as { port: number }).port
  await new Promise<void>((resolve) => probe.close(() => resolve()))
  const root = await mkdtemp(path.join(os.tmpdir(), "orbit-brain-http-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL("./server.ts", import.meta.url))],
    {
      env: {
        ...process.env,
        BRAIN_SERVER_TOKEN: "test-token-with-at-least-24-chars",
        BRAIN_SERVER_PORT: String(port),
        BRAIN_VAULT_PATH: root,
      },
      stdio: "ignore",
    }
  )
  t.after(() => child.kill())
  const endpoint = `http://127.0.0.1:${port}/mcp`
  let ready = false
  for (let attempt = 0; attempt < 150 && !ready; attempt++) {
    try {
      ready =
        (
          await fetch(endpoint, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{}",
          })
        ).status === 401
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
  }
  if (!ready) throw new Error("Brain-Server wurde nicht erreichbar.")
  const headers = {
    authorization: "Bearer test-token-with-at-least-24-chars",
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
  }
  // Antwort kommt als SSE („event: message“, „data: {json}“) oder als JSON.
  const rpc = async (response: Response) => {
    const text = await response.text()
    const data = text.match(/^data: (.*)$/m)?.[1] ?? text
    return JSON.parse(data) as {
      result: { tools?: { name: string }[]; content?: unknown }
    }
  }
  const post = (body: object) =>
    fetch(endpoint, { method: "POST", headers, body: JSON.stringify(body) })
  assert.equal(
    (
      await post({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "test", version: "1" },
        },
      })
    ).status,
    200
  )
  const listed = await post({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
    params: {},
  })
  assert.equal(listed.status, 200)
  assert.equal(
    (await rpc(listed)).result.tools?.some(
      (item) => item.name === "brain_search"
    ),
    true
  )
  const called = await post({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "brain_search", arguments: { query: "nothing" } },
  })
  assert.equal(called.status, 200)
  assert.match(JSON.stringify(await rpc(called)), /\[\]/)
})
