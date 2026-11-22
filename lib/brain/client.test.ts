import assert from "node:assert/strict"
import test from "node:test"

import { createBrainClient } from "./client.ts"

test("fehlende Konfiguration liefert eine klare Meldung ohne Anfrage", async () => {
  const client = createBrainClient({}, () => {
    throw new Error("unexpected fetch")
  })
  assert.deepEqual(await client.search("test"), {
    ok: false,
    error: "Brain ist nicht eingerichtet.",
  })
})

test("MCP-Erfolg wird als Wert zurückgegeben", async () => {
  const fetchMock = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body)) as {
      id?: string | number
      method: string
    }
    if (request.method === "notifications/initialized")
      return new Response(null, { status: 202 })
    const result =
      request.method === "initialize"
        ? {
            protocolVersion: "2025-11-25",
            capabilities: { tools: {} },
            serverInfo: { name: "test", version: "1" },
          }
        : { content: [{ type: "text", text: "Suchergebnis" }] }
    return Response.json({ jsonrpc: "2.0", id: request.id, result })
  }) as typeof fetch
  const client = createBrainClient(
    {
      BRAIN_SERVER_URL: "https://brain.test/mcp",
      BRAIN_SERVER_TOKEN: "secret",
    },
    fetchMock
  )
  assert.deepEqual(await client.search("test"), {
    ok: true,
    data: "Suchergebnis",
  })
})

test("offline, Timeout und 401 werden ohne Secret als Offline-Ergebnis gemeldet", async () => {
  for (const fetchImpl of [
    (() => Promise.reject(new Error("offline"))) as typeof fetch,
    ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) =>
        init?.signal?.addEventListener("abort", () =>
          reject(new Error("aborted"))
        )
      )) as typeof fetch,
    (() => Promise.resolve(new Response("", { status: 401 }))) as typeof fetch,
  ]) {
    const client = createBrainClient(
      {
        BRAIN_SERVER_URL: "http://localhost/mcp",
        BRAIN_SERVER_TOKEN: "secret-value",
      },
      fetchImpl
    )
    const result = await client.read("01 Inbox/Test.md")
    assert.deepEqual(result, {
      ok: false,
      error: "Brain nicht erreichbar (Mac aus oder Tunnel offline).",
    })
  }
})

test("Tool-Validierungsfehler werden als Text durchgereicht", async () => {
  const fetchMock = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body)) as {
      id?: string | number
      method: string
    }
    if (request.method === "notifications/initialized")
      return new Response(null, { status: 202 })
    const result =
      request.method === "initialize"
        ? {
            protocolVersion: "2025-11-25",
            capabilities: { tools: {} },
            serverInfo: { name: "test", version: "1" },
          }
        : {
            content: [{ type: "text", text: "Kopfstück fehlt." }],
            isError: true,
          }
    return Response.json({ jsonrpc: "2.0", id: request.id, result })
  }) as typeof fetch
  const client = createBrainClient(
    {
      BRAIN_SERVER_URL: "https://brain.test/mcp",
      BRAIN_SERVER_TOKEN: "secret",
    },
    fetchMock
  )
  assert.deepEqual(await client.write("01 Inbox/x.md", "x", "create"), {
    ok: false,
    error: "Kopfstück fehlt.",
  })
})
