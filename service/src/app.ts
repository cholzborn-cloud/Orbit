import type { UIMessage } from "ai"
import { Hono } from "hono"
import { bodyLimit } from "hono/body-limit"
import { z } from "zod"

import { TurnBuffers } from "./chat/buffer.ts"
import { validateRequest, WEB_ORIGIN } from "./security.ts"
import type { InteractionManager } from "./interactions"
import type { Resume } from "./chat/resume"

export type AppOptions = {
  token: string
  port: number
  store: {
    ownsChat(chatId: string): Promise<boolean>
    listMessages(chatId: string): Promise<UIMessage[]>
    clearMessages(chatId: string): Promise<void>
    listReactions?(chatId: string): Promise<unknown[]>
  }
  runTurn(input: {
    chatId: string
    body: Record<string, unknown>
    signal: AbortSignal
  }): Promise<Response>
  reserveTurn?: (chatId: string) => (() => void) | undefined
  // Stopp in einem Chat bricht zusätzlich alle Orbis des Auftrags ab, dessen Root dieser Chat ist.
  stopRoot?: (chatId: string) => boolean
  turns?: TurnBuffers
  interactions?: InteractionManager
  eventStream?: () => Response
  // Phase 5: „Weiter“ nach einem Neustart und der Unterbrochen-Hinweis je Chat.
  resume?: Resume
  // Phase 5: Zustände der Health-Prüfung (`GET /v1/health?checks=1`); ohne sie bleibt es bei { ok: true }.
  healthChecks?: () => Promise<unknown>
  // REST-Endpunkte und OAuth-Rücksprung hängen an Datenbank und Actions, daher von außen übergeben.
  routes?: (app: Hono) => void
  oauthCallback?: (request: Request) => Promise<Response>
}

export function createApp({
  token,
  port,
  store,
  runTurn,
  turns = new TurnBuffers(),
  reserveTurn,
  stopRoot,
  interactions,
  eventStream,
  resume,
  healthChecks,
  routes,
  oauthCallback,
}: AppOptions) {
  const app = new Hono()
  const clearing = new Set<string>()
  app.use("*", async (c, next) => {
    const request = c.req.raw
    const origin = request.headers.get("origin")
    const preflight =
      request.method === "OPTIONS" &&
      origin === WEB_ORIGIN &&
      request.headers.get("host") === `127.0.0.1:${port}` &&
      ["GET", "POST", "PUT", "PATCH", "DELETE"].includes(
        request.headers.get("access-control-request-method") ?? ""
      ) &&
      (request.headers.get("access-control-request-headers") ?? "")
        .split(",")
        .every((name) =>
          ["", "authorization", "content-type"].includes(
            name.trim().toLowerCase()
          )
        )
    if (preflight) {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": WEB_ORIGIN,
          "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE",
          "Access-Control-Allow-Headers": "Authorization, Content-Type",
          Vary: "Origin",
        },
      })
    }
    const failure = validateRequest(request, token, port)
    if (failure) return c.json({ error: "Zugriff verweigert." }, failure)
    await next()
    // SSE liefert eine eigene Response; CORS muss auf deren endgültige Header.
    if (origin === WEB_ORIGIN) {
      c.header("Access-Control-Allow-Origin", WEB_ORIGIN)
      c.header("Access-Control-Expose-Headers", "x-vercel-ai-ui-message-stream")
      c.header("Vary", "Origin")
    }
  })
  app.use(
    "/v1/chats/:id/turn",
    bodyLimit({
      maxSize: 25 * 1024 * 1024,
      onError: (c) => c.json({ error: "Die Nachricht ist zu groß." }, 413),
    })
  )
  app.get("/v1/health", async (c) => {
    if (c.req.query("checks") !== "1" || !healthChecks) return c.json({ ok: true })
    try {
      return c.json({ ok: true, checks: await healthChecks() })
    } catch {
      return c.json({ ok: true, checks: null })
    }
  })
  app.get("/oauth/callback", (c) =>
    oauthCallback
      ? oauthCallback(c.req.raw)
      : c.json({ error: "Anmeldung ist nicht verfügbar." }, 503)
  )
  routes?.(app)
  app.get(
    "/v1/events",
    (c) =>
      eventStream?.() ??
      c.json({ error: "Ereignisse sind nicht verfügbar." }, 503)
  )
  app.get("/v1/approvals", (c) =>
    c.json({
      approvals:
        interactions?.list().filter((item) => item.kind === "approval") ?? [],
    })
  )
  app.post("/v1/approvals/:id/decide", async (c) => {
    const parsed = z
      .object({ decision: z.enum(["once", "always", "deny"]) })
      .safeParse(await c.req.json().catch(() => null))
    if (!parsed.success || !interactions)
      return c.json({ error: "Ungültige Entscheidung." }, 400)
    if (
      !interactions
        .list()
        .some(
          (item) => item.id === c.req.param("id") && item.kind === "approval"
        )
    )
      return c.json({ error: "Freigabe ist nicht mehr offen." }, 410)
    const result = await interactions.decide(c.req.param("id"), {
      approved: parsed.data.decision !== "deny",
      always: parsed.data.decision === "always",
    })
    return result.ok
      ? c.json({ ok: true })
      : c.json(
          {
            error:
              result.error === "expired"
                ? "Die Freigabe ist abgelaufen."
                : "Die Entscheidung konnte nicht gespeichert werden.",
          },
          result.error === "storage" ? 500 : 409
        )
  })
  app.post("/v1/questions/:id/answer", async (c) => {
    if (
      !interactions ||
      !interactions
        .list()
        .some((item) => item.id === c.req.param("id") && item.kind === "ask")
    )
      return c.json({ error: "Die Rückfrage ist nicht mehr offen." }, 410)
    const result = await interactions.decide(c.req.param("id"), {
      answer: await c.req.json().catch(() => null),
    })
    return result.ok
      ? c.json({ ok: true })
      : c.json(
          {
            error:
              "Die Antwort ist ungültig oder die Rückfrage ist abgelaufen.",
          },
          400
        )
  })
  app.use("/v1/chats/:id/*", async (c, next) => {
    if (!(await store.ownsChat(c.req.param("id")!))) {
      return c.json({ error: "Chat nicht gefunden." }, 404)
    }
    await next()
  })
  app.post("/v1/chats/:id/turn", async (c) => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: "Ungültige Anfrage." }, 400)
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return c.json({ error: "Ungültige Anfrage." }, 400)
    }
    const chatId = c.req.param("id")
    const release = !clearing.has(chatId)
      ? reserveTurn
        ? reserveTurn(chatId)
        : () => {}
      : undefined
    if (!release)
      return c.json(
        { error: "In diesem Chat läuft bereits eine Antwort." },
        409
      )
    if (
      !turns.start(
        chatId,
        (signal) =>
          runTurn({ chatId, body: body as Record<string, unknown>, signal }),
        release
      )
    ) {
      release()
      return c.json(
        { error: "In diesem Chat läuft bereits eine Antwort." },
        409
      )
    }
    return (await turns.response(chatId))!
  })
  // „Weiter“ nach einem Neustart: startet den unterbrochenen Turn mit der letzten Nachricht von Consti neu; `dismiss` verwirft nur den Hinweis.
  app.post("/v1/chats/:id/resume", async (c) => {
    const parsed = z
      .object({ runId: z.string().min(1).max(100), dismiss: z.boolean().optional() })
      .safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: "Ungültige Anfrage." }, 400)
    if (!resume) return c.json({ error: "Fortsetzen ist nicht verfügbar." }, 503)
    const chatId = c.req.param("id")
    if (parsed.data.dismiss)
      return resume.dismiss(chatId, parsed.data.runId)
        ? c.json({ ok: true })
        : c.json({ error: "Unterbrochene Arbeit nicht gefunden." }, 404)
    const prepared = await resume.prepare(chatId, parsed.data.runId)
    if (!prepared.ok) return c.json({ error: prepared.error }, prepared.status)
    const release = !clearing.has(chatId)
      ? reserveTurn
        ? reserveTurn(chatId)
        : () => {}
      : undefined
    if (!release)
      return c.json({ error: "In diesem Chat läuft bereits eine Antwort." }, 409)
    if (
      !turns.start(
        chatId,
        (signal) => runTurn({ chatId, body: prepared.body, signal }),
        release
      )
    ) {
      release()
      return c.json({ error: "In diesem Chat läuft bereits eine Antwort." }, 409)
    }
    resume.started(parsed.data.runId)
    return c.json({ ok: true })
  })
  app.get("/v1/chats/:id/stream", async (c) => {
    return (await turns.response(c.req.param("id"))) ?? c.body(null, 204)
  })
  app.post("/v1/chats/:id/stop", (c) => {
    const id = c.req.param("id")
    // Erst den Auftrag, dann den Turn: so weckt das Ende des Root-Turns niemanden mehr.
    const chain = stopRoot?.(id) ?? false
    return c.json({ stopped: turns.stop(id) || chain })
  })
  app.delete("/v1/chats/:id/messages", async (c) => {
    const chatId = c.req.param("id")
    if (clearing.has(chatId) || turns.isRunning(chatId)) {
      return c.json(
        { error: "Bitte zuerst die laufende Antwort stoppen." },
        409
      )
    }
    clearing.add(chatId)
    try {
      await store.clearMessages(chatId)
      turns.forget(chatId)
      return c.json({ ok: true })
    } finally {
      clearing.delete(chatId)
    }
  })
  app.get("/v1/chats/:id/messages", async (c) =>
    c.json({
      ...messagePage(
        await store.listMessages(c.req.param("id")),
        c.req.query("limit"),
        c.req.query("before")
      ),
      ...(resume ? { interrupted: resume.interrupted(c.req.param("id")) } : {}),
      ...(store.listReactions
        ? { reactions: await store.listReactions(c.req.param("id")) }
        : {}),
    })
  )
  app.notFound((c) => c.json({ error: "Nicht gefunden." }, 404))
  app.onError(
    (_error, c) =>
      new Response(
        JSON.stringify({
          error: "Der lokale Dienst konnte die Anfrage nicht verarbeiten.",
        }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            ...(c.req.header("origin") === WEB_ORIGIN
              ? { "Access-Control-Allow-Origin": WEB_ORIGIN, Vary: "Origin" }
              : {}),
          },
        }
      )
  )
  return app
}

// Verlauf seitenweise: ohne `limit` alles wie bisher; mit `limit` die neuesten `limit` Nachrichten (vor `before`, einer Nachrichten-ID)
// und `hasMore`, ob es davor noch ältere gibt. Unbekanntes `before` liefert eine leere Seite, damit Nachladen nicht endlos wiederholt.
// shortcut: liest den ganzen Verlauf und schneidet danach; bei sehr langen Chats LIMIT/OFFSET in listMessages verlagern.
export function messagePage(
  all: UIMessage[],
  limitParam: string | undefined,
  before: string | undefined
): { messages: UIMessage[]; hasMore?: boolean } {
  const limit = Number(limitParam)
  if (!limitParam || !Number.isInteger(limit) || limit < 1) return { messages: all }
  const end = before ? all.findIndex((m) => m.id === before) : all.length
  if (end < 0) return { messages: [], hasMore: false }
  const start = Math.max(0, end - Math.min(limit, 500))
  return { messages: all.slice(start, end), hasMore: start > 0 }
}
