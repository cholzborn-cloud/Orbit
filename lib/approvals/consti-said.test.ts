import assert from "node:assert/strict"
import { test } from "node:test"
import { asSchema, jsonSchema, tool } from "ai"
import { z } from "zod"

import { withConstiSaid } from "./consti-said.ts"

test("consti_said: Schema bekommt das Feld, Validierung behält es, das Original sieht es nie", async () => {
  const seen: unknown[] = []
  const zodTool = withConstiSaid(
    tool({ inputSchema: z.object({ command: z.string() }).strict(), execute: async (input) => (seen.push(input), "ok") })
  )
  const schema = asSchema(zodTool.inputSchema)
  const json = await schema.jsonSchema
  assert.equal((json.properties as Record<string, { type: string }>).consti_said!.type, "string")
  assert.deepEqual(await schema.validate!({ command: "rm a", consti_said: "lösch a bitte" }), {
    success: true,
    value: { command: "rm a", consti_said: "lösch a bitte" },
  })
  assert.equal((await schema.validate!({ command: 1 })).success, false)
  await zodTool.execute!({ command: "rm a", consti_said: "x" } as never, {} as never)
  assert.deepEqual(seen, [{ command: "rm a" }])

  // MCP-Werkzeuge haben ein reines JSON-Schema ohne Validator.
  const mcp = withConstiSaid(tool({ inputSchema: jsonSchema({ type: "object", properties: { to: { type: "string" } }, additionalProperties: false }), execute: async (input) => input }))
  const mcpJson = await asSchema(mcp.inputSchema).jsonSchema
  assert.deepEqual(Object.keys(mcpJson.properties ?? {}), ["to", "consti_said"])
  assert.deepEqual(await mcp.execute!({ to: "a", consti_said: "schick a" } as never, {} as never), { to: "a" })
})
