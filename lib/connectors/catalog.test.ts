import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { test } from "node:test"

import { catalogOverride, parseConnectorCatalog } from "./catalog.ts"

test("der Katalog hat gültige Skill- und MCP-Einträge", async () => {
  const content = await readFile(
    new URL("../../connectors/catalog.json", import.meta.url),
    "utf8"
  )
  const result = parseConnectorCatalog(JSON.parse(content))
  assert.equal(result.success, true)
  if (!result.success) return
  assert.ok(result.data.filter((entry) => entry.type === "skill").length >= 4)
  assert.ok(result.data.filter((entry) => entry.type === "mcp").length >= 2)
  assert.ok(
    result.data
      .filter((entry) => entry.type === "mcp")
      .every((entry) => !entry.verified)
  )
})

test("Katalog-Override für Freigaben hängt an der URL", () => {
  const parsed = parseConnectorCatalog([
    { id: "m", name: "M", description: "d", type: "mcp", source: "s", risk: "write", permissions: "p", verified: true, url: "https://m.example/mcp", ask: { sync: "loeschen" }, free: ["send_preview"] },
  ])
  assert.equal(parsed.success, true)
  if (!parsed.success) return
  assert.deepEqual(catalogOverride(parsed.data, "https://m.example/mcp"), { ask: { sync: "loeschen" }, free: ["send_preview"] })
  assert.equal(catalogOverride(parsed.data, "https://other.example/mcp"), undefined)
  assert.equal(parseConnectorCatalog([{ ...parsed.data[0], ask: { sync: "quatsch" } }]).success, false)
})
