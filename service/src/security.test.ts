import assert from "node:assert/strict"
import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { loadServiceToken, validateRequest } from "./security.ts"

const token = "a".repeat(64)
function request(headers: Record<string, string> = {}) {
  return new Request("http://127.0.0.1:4318/v1/health", {
    headers: {
      host: "127.0.0.1:4318",
      authorization: `Bearer ${token}`,
      ...headers,
    },
  })
}

test("Token, exakter Host und Origin werden unabhängig geprüft", () => {
  assert.equal(validateRequest(request(), token, 4318), null)
  assert.equal(
    validateRequest(request({ origin: "http://localhost:3000" }), token, 4318),
    null
  )
  for (const host of [
    "localhost:4318",
    "127.0.0.1",
    "evil.test:4318",
    "127.0.0.1:4319",
  ]) {
    assert.equal(validateRequest(request({ host }), token, 4318), 403)
  }
  for (const origin of ["null", "https://localhost:3000", "http://evil.test"]) {
    assert.equal(validateRequest(request({ origin }), token, 4318), 403)
  }
  for (const authorization of [
    "",
    "Bearer wrong",
    `Bearer ${"b".repeat(64)}`,
    `bearer ${token}`,
  ]) {
    assert.equal(validateRequest(request({ authorization }), token, 4318), 401)
  }
})

test("Token wird mit 0600 erstellt, wiederverwendet und unsichere Datei abgewiesen", async () => {
  const directory = await mkdtemp(join(tmpdir(), "orbit-token-"))
  try {
    const first = await loadServiceToken(directory)
    assert.match(first, /^[a-f0-9]{64}$/)
    assert.equal(await loadServiceToken(directory), first)
    const path = join(directory, "service.token")
    assert.equal((await stat(path)).mode & 0o777, 0o600)
    assert.equal(await readFile(path, "utf8"), first)
    await chmod(path, 0o644)
    await assert.rejects(loadServiceToken(directory), /0600/)
    await chmod(path, 0o600)
    await writeFile(path, "ungültig")
    await assert.rejects(loadServiceToken(directory), /ungültig/)
    await rm(path)
    await symlink(join(directory, "other"), path)
    await assert.rejects(loadServiceToken(directory))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
