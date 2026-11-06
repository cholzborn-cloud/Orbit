import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import { test } from "node:test"

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      !context.parentURL?.includes("/node_modules/") &&
      specifier.startsWith(".") &&
      !/\.[cm]?js$|\.ts$/.test(specifier)
    )
      return nextResolve(`${specifier}.ts`, context)
    return nextResolve(specifier, context)
  },
})

const { insertJevLog } = await import("./log.ts")

test("Jev-Protokoll setzt die erforderliche ID im Insert", async () => {
  let query = ""
  let values: unknown[] = []
  await insertJevLog(
    async (strings, ...params) => {
      query = strings.join("?")
      values = params
      return []
    },
    {
      userId: "user",
      info: { kind: "route", reason: "test", durationMs: 1, source: "jev" },
    },
    "row-id"
  )
  assert.match(query, /insert into jev_log \(id, user_id/)
  assert.equal(values[0], "row-id")
})
