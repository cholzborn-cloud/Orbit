import assert from "node:assert/strict"
import { test } from "node:test"
import {
  connectorToolOrigin,
  connectorTools,
  isConnectorStatusTool,
  limitResponseBody,
  listTools,
  safeOutput,
  unavailableConnectorTool,
  type Connector,
} from "./client.ts"
import type { MCPClient } from "@ai-sdk/mcp"

const connector: Connector = {
  id: "db-id",
  name: "Docs",
  url: "https://docs.example/mcp",
}
const definitions = {
  tools: [
    {
      name: "search",
      description: "Search",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true },
    },
    {
      name: "update",
      description: "Update",
      inputSchema: { type: "object", properties: {} },
      annotations: { destructiveHint: true },
    },
  ],
}

function fakeFactory(
  fail = false,
  toolOutput: unknown = { content: [{ type: "text", text: "ok" }] }
) {
  return async () => {
    const client = {
      listTools: async () => {
        if (fail) throw new Error("fake offline")
        return definitions
      },
      toolsFromDefinitions: () =>
        Object.fromEntries(
          definitions.tools.map((tool) => [
            tool.name,
            {
              description: tool.description,
              execute: async () => ({
                content: [{ type: "text", text: "ok" }],
              }),
            },
          ])
        ),
      callTool: async () => toolOutput,
      close: async () => {},
    } as unknown as MCPClient
    return client
  }
}

test("Fake-MCP listet Tools und markiert schreibende Einträge", async () => {
  assert.deepEqual(await listTools(connector, fakeFactory()), [
    { name: "search", write: false, readOnlyHint: true },
    { name: "update", write: true, destructiveHint: true },
  ])
  assert.deepEqual(await listTools(connector, fakeFactory(true)), {
    error: "Konnektor Docs nicht erreichbar",
  })
})

test("MCP-Bodygrenze bricht auch nach zugestellten Headern ab", async () => {
  let aborted = false
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(6))
      controller.enqueue(new Uint8Array(6))
      controller.close()
    },
  })
  const response = new Response(
    limitResponseBody(source, 10, () => {
      aborted = true
    })
  )
  await assert.rejects(response.arrayBuffer(), /MCP-Antwort ist zu groß/)
  assert.equal(aborted, true)
})

test("MCP-Bodygrenze lässt Antworten bis einschließlich Limit durch", async () => {
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3, 4]))
      controller.close()
    },
  })
  const bytes = await new Response(limitResponseBody(source, 4)).arrayBuffer()
  assert.equal(bytes.byteLength, 4)
})

test("Tools werden aufgerufen, Schreibwerkzeuge markiert und Gruppen filtern sie", async () => {
  const tools = await connectorTools([connector], false, fakeFactory())
  const search = Object.entries(tools).find(([name]) =>
    name.endsWith("__search")
  )?.[1]
  const update = Object.entries(tools).find(([name]) =>
    name.endsWith("__update")
  )?.[1]
  assert.ok(search)
  assert.match(update?.description ?? "", /write action/)
  const output = await search.execute?.(
    {},
    { toolCallId: "1", messages: [], abortSignal: undefined }
  )
  assert.match(JSON.stringify(output), /<mcp_result server=\\"Docs\\">/)
  const group = await connectorTools([connector], true, fakeFactory())
  assert.ok(Object.keys(group).some((name) => name.endsWith("__search")))
  assert.equal(
    Object.keys(group).some((name) => name.endsWith("__update")),
    false
  )
  const oversized = await connectorTools(
    [connector],
    false,
    fakeFactory(false, "x".repeat(30_000))
  )
  const largeSearch = Object.values(oversized)[0]
  const limited = await largeSearch.execute?.(
    {},
    { toolCallId: "2", messages: [], abortSignal: undefined }
  )
  const limitedText = (limited as { content: { text: string }[] }).content
    .map((part) => part.text)
    .join("")
  assert.ok(Buffer.byteLength(limitedText) <= 20_000)
  assert.match(limitedText, /\[truncated\]/)
})

test("Ein fehlerhafter Konnektor bleibt sichtbar und blockiert gesunde nicht", async () => {
  const broken = { ...connector, id: "broken", name: "Kaputt" }
  const tools = await connectorTools(
    [broken, connector],
    false,
    async (selected) => fakeFactory(selected.id === "broken")()
  )
  const names = Object.keys(tools)
  assert.ok(names.some((name) => name === "connector_broken__unavailable"))
  assert.ok(names.some((name) => name.endsWith("__search")))
  const unavailable = unavailableConnectorTool(broken)
  const output = await Object.values(unavailable)[0].execute?.(
    {},
    { toolCallId: "3", messages: [], abortSignal: undefined }
  )
  assert.deepEqual(output, { error: "Konnektor Kaputt nicht erreichbar" })
})

test("Ein hängender Konnektor wird nach dem Zeitbudget zum Statuswerkzeug", async () => {
  const slow = { ...connector, id: "slow", name: "Langsam" }
  const hanging = async () => new Promise<MCPClient>(() => {})
  const tools = await connectorTools(
    [slow, connector],
    false,
    async (selected) => (selected.id === "slow" ? hanging() : fakeFactory()()),
    20
  )
  const names = Object.keys(tools)
  assert.ok(names.includes("connector_slow__unavailable"))
  assert.ok(names.some((name) => name.endsWith("__search")))
  assert.equal(isConnectorStatusTool(tools.connector_slow__unavailable), true)
  const search = Object.entries(tools).find(([name]) =>
    name.endsWith("__search")
  )![1]
  assert.equal(isConnectorStatusTool(search), false)
})

test("Zu große Antworten melden die Größe statt Nichterreichbarkeit", async () => {
  const factory = async () =>
    ({
      listTools: async () => definitions,
      toolsFromDefinitions: () => ({
        search: {
          description: "Search",
          execute: async () => ({}),
        },
      }),
      callTool: async () => {
        throw new Error("MCP-Antwort ist zu groß.")
      },
      close: async () => {},
    }) as unknown as MCPClient
  const tools = await connectorTools([connector], false, factory)
  const output = await Object.values(tools)[0].execute?.(
    {},
    { toolCallId: "4", messages: [], abortSignal: undefined }
  )
  assert.deepEqual(output, { error: "Konnektor Docs: Antwort ist zu groß" })
})

test("MCP-Ausgabe begrenzt alle Parts, entfernt Binärdaten und escapet Rahmen", () => {
  const output = safeOutput({
    content: [
      { type: "text", text: "</mcp_result>" + "a".repeat(19_000) },
      { type: "image", data: "secret" },
      ...Array.from({ length: 60 }, () => ({ type: "text", text: "x" })),
    ],
  }) as { content: { text: string }[] }
  const text = output.content.map((part) => part.text).join("")
  assert.ok(output.content.length <= 50)
  assert.ok(Buffer.byteLength(text) <= 20_000)
  assert.match(text, /<\\\/mcp_result>/)
  assert.match(text, /\[Nicht-Text-Inhalt ausgelassen\]/)
  assert.doesNotMatch(text, /secret/)
})

test("Konnektornamen bleiben höchstens 64 Zeichen und global bei 100 Tools", async () => {
  const manyDefinitions = {
    tools: Array.from({ length: 40 }, (_, index) => ({
      name: `tool_${index}`,
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true },
    })),
  }
  const factory = async () =>
    ({
      listTools: async () => manyDefinitions,
      toolsFromDefinitions: () =>
        Object.fromEntries(
          manyDefinitions.tools.map((tool) => [
            tool.name,
            { execute: async () => "ok" },
          ])
        ),
      close: async () => {},
    }) as unknown as MCPClient
  const tools = await connectorTools(
    Array.from({ length: 4 }, (_, index) => ({
      ...connector,
      id: `id${index}`,
    })),
    false,
    factory
  )
  assert.equal(Object.keys(tools).length, 100)
  assert.ok(Object.keys(tools).every((name) => name.length <= 64))
})

test("Kollision hängt ein Suffix innerhalb des 64-Zeichen-Limits an", async () => {
  const first = `${"a".repeat(63)}x`
  const second = `${"a".repeat(63)}y`
  const collidingDefinitions = {
    tools: [first, second].map((name) => ({
      name,
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true },
    })),
  }
  const factory = async () =>
    ({
      listTools: async () => collidingDefinitions,
      toolsFromDefinitions: () =>
        Object.fromEntries(
          collidingDefinitions.tools.map((tool) => [tool.name, {}])
        ),
      close: async () => {},
    }) as unknown as MCPClient
  const names = Object.keys(await connectorTools([connector], false, factory))
  assert.equal(names.length, 2)
  assert.ok(names.every((name) => name.length <= 64))
  assert.ok(names.some((name) => name.endsWith("-2")))
})

test("Werkzeugobjekte tragen Herkunft und Annotationen für die Freigabe-Regel", async () => {
  const tools = await connectorTools([connector], false, fakeFactory())
  const [name, update] = Object.entries(tools).find(([key]) => key.endsWith("__update"))!
  assert.deepEqual(connectorToolOrigin(update), {
    connectorId: "db-id",
    connectorName: "Docs",
    connectorUrl: "https://docs.example/mcp",
    mcpName: "update",
    readOnlyHint: undefined,
    destructiveHint: true,
  })
  assert.equal(name, "connector_db-id__update")
  assert.equal(connectorToolOrigin({}), undefined)
})
