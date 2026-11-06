import assert from "node:assert/strict"
import { test } from "node:test"

import { build } from "esbuild"

// Der Dienst darf weder Trigger.dev noch Next.js noch irgendetwas aus trigger/ laden: Rückweg-Code bleibt getrennt.
test("Importgraph des Dienstes enthält kein trigger/-Code, Trigger-SDK oder next", async () => {
  const result = await build({
    entryPoints: ["service/src/index.ts"],
    tsconfig: "service/tsconfig.json",
    bundle: true,
    write: false,
    metafile: true,
    platform: "node",
    format: "esm",
    packages: "external",
    logLevel: "silent",
  })
  const inputs = Object.keys(result.metafile.inputs)
  const external = Object.values(result.metafile.outputs).flatMap((output) =>
    output.imports.filter((entry) => entry.external).map((entry) => entry.path)
  )
  // Beweis, dass der Graph wirklich durch die Actions läuft.
  assert.ok(inputs.includes("actions/automations.ts"))
  assert.ok(inputs.includes("lib/chat/sandbox-tools.ts"))
  assert.deepEqual(
    inputs.filter((file) => file.startsWith("trigger/")),
    []
  )
  assert.deepEqual(
    external.filter((path) => /^@trigger\.dev|^next(\/|$)/.test(path)),
    []
  )
})
