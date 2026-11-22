import type { Hono } from "hono"
import { bodyLimit } from "hono/body-limit"
import type { ReminderBridge } from "./reminders.ts"

export function registerReminderRoutes(app: Hono, bridge: ReminderBridge) {
  // 100 Einträge à 700 Zeichen können als JSON bis zu sechs Bytes je Zeichen brauchen.
  app.use("/v1/reminders/:id/complete", bodyLimit({ maxSize: 512 * 1024, onError: (c) => c.json({ error: "Antwort zu groß." }, 413) }))
  app.post("/v1/reminders/claim", (c) => c.json({ task: bridge.claim() }))
  app.get("/v1/reminders/:id/active", (c) => c.json({ active: bridge.isActive(c.req.param("id")) }))
  app.post("/v1/reminders/:id/complete", async (c) => {
    const body = await c.req.json().catch(() => null)
    return bridge.complete(c.req.param("id"), body) ? c.json({ ok: true }) : c.json({ error: "Auftrag nicht verfügbar." }, 409)
  })
}
