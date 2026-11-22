import { execFile } from "node:child_process"
import { randomUUID } from "node:crypto"

import { generateText } from "ai"

import { touchChat } from "@/lib/chat/agent"
import { getDatabase } from "@/lib/db/client"
import {
  dueHeartbeats,
  HEARTBEAT_IDLE_MAX_S,
  HEARTBEAT_MODEL,
  runHeartbeat,
  type HeartbeatGenerate,
  type HeartbeatResult,
} from "@/lib/orbi/heartbeat"
import { cli } from "@/lib/cli/provider"

import type { createMessageStore } from "./chat/store"

// Sekunden seit der letzten Eingabe am Mac (HIDIdleTime aus ioreg, in Nanosekunden). Unlesbar = unbekannt (dann gilt der Mac als nicht aktiv).
export function macIdleSeconds(): Promise<number | null> {
  return new Promise((resolve) =>
    execFile("/usr/sbin/ioreg", ["-c", "IOHIDSystem", "-d", "4"], { timeout: 3_000, maxBuffer: 1_000_000 }, (error, stdout) => {
      if (error) return resolve(null)
      const match = /"HIDIdleTime"\s*=\s*(\d+)/.exec(stdout)
      resolve(match ? Number(match[1]) / 1e9 : null)
    })
  )
}

// Haiku über die claude-CLI (nie Jev/OpenRouter), ohne Werkzeuge.
export const cliHeartbeatGenerate: HeartbeatGenerate = async ({ system, prompt, signal }) => {
  const result = await generateText({ model: cli.chat(HEARTBEAT_MODEL), system, prompt, maxOutputTokens: 200, abortSignal: signal })
  return { text: result.text }
}

// Heartbeat im Takt des Dienstes: fällige Orbis nacheinander, still, Fehler nur im Protokoll.
export function createHeartbeat(options: {
  store: Pick<ReturnType<typeof createMessageStore>, "upsertMessage">
  generate?: HeartbeatGenerate
  idleSeconds?: () => Promise<number | null>
  onPosted?: (chatId: string, botId: string) => void
}) {
  const generate = options.generate ?? cliHeartbeatGenerate
  const idle = options.idleSeconds ?? macIdleSeconds
  let chain: Promise<unknown> = Promise.resolve()
  const run = (botId: string, now: Date): Promise<HeartbeatResult> => {
    const next = chain.then(() =>
      runHeartbeat({
        db: getDatabase().$client,
        botId,
        generate,
        now: () => now.getTime(),
        post: async ({ botId: id, chatId, text }) => {
          await options.store.upsertMessage(chatId, {
            id: randomUUID(),
            role: "assistant",
            parts: [{ type: "text", text }],
            metadata: { botId: id, model: HEARTBEAT_MODEL, finishedAt: Date.now() },
          })
          await touchChat(chatId)
          options.onPosted?.(chatId, id)
          return true
        },
      })
    )
    chain = next.catch(() => {})
    return next
  }
  return {
    run,
    async tick(now: Date): Promise<HeartbeatResult[]> {
      // Ohne eingeschalteten Orbi nichts prüfen (auch nicht die Mac-Aktivität).
      if (!getDatabase().$client.prepare("select 1 from bots where user_id = 'local' and heartbeat_enabled = 1 limit 1").get()) return []
      const seconds = await idle()
      const active = seconds !== null && seconds < HEARTBEAT_IDLE_MAX_S
      const due = dueHeartbeats(getDatabase().$client, now, active)
      return Promise.all(
        due.map((botId) =>
          run(botId, now).catch((): HeartbeatResult => {
            console.error("Heartbeat fehlgeschlagen.")
            return { status: "error", error: "Heartbeat fehlgeschlagen." }
          })
        )
      )
    },
  }
}
