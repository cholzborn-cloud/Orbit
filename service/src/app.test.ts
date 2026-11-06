import assert from "node:assert/strict"
import test from "node:test"
import { createUIMessageStreamResponse } from "ai"

import { createApp, messagePage } from "./app.ts"

const app = createApp({
  token: "test-token",
  port: 4318,
  store: {
    ownsChat: async (id) => id === "known",
    listMessages: async () => [],
    clearMessages: async () => {},
  },
  runTurn: async () =>
    createUIMessageStreamResponse({
      stream: new ReadableStream({
        start(c) {
          c.close()
        },
      }),
    }),
})
function request(path: string, init: RequestInit = {}) {
  return app.request(`http://127.0.0.1:4318${path}`, {
    ...init,
    headers: {
      host: "127.0.0.1:4318",
      authorization: "Bearer test-token",
      ...init.headers,
    },
  })
}

test("Health braucht Token; nur erlaubter Preflight darf ohne Token antworten", async () => {
  assert.equal((await request("/v1/health")).status, 200)
  const sse = await request("/v1/chats/known/turn", {
    method: "POST",
    headers: {
      origin: "http://localhost:3000",
      "content-type": "application/json",
    },
    body: "{}",
  })
  assert.equal(
    sse.headers.get("access-control-allow-origin"),
    "http://localhost:3000"
  )
  assert.equal(sse.headers.get("x-vercel-ai-ui-message-stream"), "v1")
  await sse.text()
  await request("/v1/chats/known/messages", { method: "DELETE" })
  assert.equal(
    (await request("/v1/health", { headers: { authorization: "" } })).status,
    401
  )
  const preflight = await request("/v1/chats/known/turn", {
    method: "OPTIONS",
    headers: {
      authorization: "",
      origin: "http://localhost:3000",
      "access-control-request-method": "POST",
      "access-control-request-headers": "authorization,content-type",
    },
  })
  assert.equal(preflight.status, 204)
  assert.equal(
    preflight.headers.get("access-control-allow-origin"),
    "http://localhost:3000"
  )
  assert.equal(
    (
      await request("/v1/health", {
        method: "OPTIONS",
        headers: {
          authorization: "",
          origin: "http://evil.test",
          "access-control-request-method": "GET",
        },
      })
    ).status,
    403
  )
  assert.equal(
    (
      await request("/v1/health", {
        method: "OPTIONS",
        headers: {
          authorization: "",
          origin: "http://localhost:3000",
          "access-control-request-method": "GET",
          "access-control-request-headers": "x-other",
        },
      })
    ).status,
    401
  )
})

test("Alle Chat-Endpunkte prüfen Eigentümer; leerer Stream ist 204 und Verlauf ist lesbar", async () => {
  for (const [suffix, method] of [
    ["turn", "POST"],
    ["stop", "POST"],
    ["messages", "GET"],
    ["messages", "DELETE"],
    ["stream", "GET"],
  ]) {
    assert.equal(
      (await request(`/v1/chats/unknown/${suffix}`, { method })).status,
      404
    )
  }
  assert.equal((await request("/v1/chats/known/stream")).status, 204)
  assert.deepEqual(await (await request("/v1/chats/known/messages")).json(), {
    messages: [],
  })
  assert.equal(
    (await request("/v1/chats/known/turn", { method: "POST", body: "[]" }))
      .status,
    400
  )
})

test("Paralleler Turn und Verlauf löschen sind während einer Antwort gesperrt", async () => {
  let finish!: () => void
  let clears = 0
  const runningApp = createApp({
    token: "test-token",
    port: 4318,
    store: {
      ownsChat: async () => true,
      listMessages: async () => [],
      clearMessages: async () => {
        clears++
      },
    },
    runTurn: async ({ signal }) =>
      createUIMessageStreamResponse({
        stream: new ReadableStream({
          start(controller) {
            finish = () => controller.close()
            signal.addEventListener(
              "abort",
              () => {
                controller.enqueue({ type: "abort" })
                controller.close()
              },
              { once: true }
            )
          },
        }),
      }),
  })
  const call = (suffix: string, method: string) =>
    runningApp.request(`http://127.0.0.1:4318/v1/chats/known/${suffix}`, {
      method,
      headers: {
        host: "127.0.0.1:4318",
        authorization: "Bearer test-token",
        "content-type": "application/json",
      },
      ...(suffix === "turn" ? { body: "{}" } : {}),
    })
  const response = await call("turn", "POST")
  assert.equal(response.status, 200)
  assert.equal((await call("turn", "POST")).status, 409)
  assert.equal((await call("messages", "DELETE")).status, 409)
  assert.equal(clears, 0)
  finish()
  await response.text()
  assert.equal((await call("messages", "DELETE")).status, 200)
  assert.equal(clears, 1)
  assert.equal((await call("stream", "GET")).status, 204)
})

test("Unerwartete Fehler zeigen keine Inhalte und behalten CORS", async () => {
  const failing = createApp({
    token: "test-token",
    port: 4318,
    store: {
      ownsChat: async () => {
        throw new Error("secret")
      },
      listMessages: async () => [],
      clearMessages: async () => {},
    },
    runTurn: async () => new Response(),
  })
  const response = await failing.request(
    "http://127.0.0.1:4318/v1/chats/known/messages",
    {
      headers: {
        host: "127.0.0.1:4318",
        authorization: "Bearer test-token",
        origin: "http://localhost:3000",
      },
    }
  )
  assert.equal(response.status, 500)
  assert.equal(
    response.headers.get("access-control-allow-origin"),
    "http://localhost:3000"
  )
  assert.doesNotMatch(await response.text(), /secret/)
})

test("Verlauf seitenweise: ohne limit alles, mit limit/before die neuesten davor und hasMore", async () => {
  const all = ["a", "b", "c", "d", "e"].map((id) => ({
    id,
    role: "user" as const,
    parts: [],
  }))
  assert.deepEqual(messagePage(all, undefined, undefined), { messages: all })
  assert.deepEqual(messagePage(all, "abc", undefined), { messages: all })
  const ids = (page: ReturnType<typeof messagePage>) => [
    page.messages.map((m) => m.id).join(""),
    page.hasMore,
  ]
  assert.deepEqual(ids(messagePage(all, "2", undefined)), ["de", true])
  assert.deepEqual(ids(messagePage(all, "2", "d")), ["bc", true])
  assert.deepEqual(ids(messagePage(all, "2", "c")), ["ab", false])
  assert.deepEqual(ids(messagePage(all, "9", undefined)), ["abcde", false])
  assert.deepEqual(ids(messagePage(all, "2", "x")), ["", false])

  const paged = createApp({
    token: "test-token",
    port: 4318,
    store: {
      ownsChat: async () => true,
      listMessages: async () => all,
      clearMessages: async () => {},
    },
    runTurn: async () => new Response(null),
  })
  const response = await paged.request(
    "http://127.0.0.1:4318/v1/chats/known/messages?limit=2&before=e",
    {
      headers: {
        host: "127.0.0.1:4318",
        authorization: "Bearer test-token",
      },
    }
  )
  const body = (await response.json()) as {
    messages: { id: string }[]
    hasMore: boolean
  }
  assert.deepEqual(
    [body.messages.map((m) => m.id), body.hasMore],
    [["c", "d"], true]
  )
})
