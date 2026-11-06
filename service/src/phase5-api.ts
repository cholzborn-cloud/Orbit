import { existsSync, readdirSync, statSync } from "node:fs"

import { pingDaytona } from "@/lib/chat/sandbox-tools"
import { localBrainPath } from "@/lib/brain/config"
import { getDatabase } from "@/lib/db/client"
import { checkAllClis } from "@/lib/cli/status"
import { budgetOverview, createSandboxSlots, getBudget, jevBlock, setBudget } from "@/lib/work/budget"
import { runHealth } from "@/lib/work/health"
import { interruptedAll } from "@/lib/work/runs"
import { sidebarStatus } from "@/lib/work/status"
import { markSeen } from "@/lib/work/store"
import { pluginStore } from "./plugins"

const db = () => getDatabase().$client

// Wartestelle für gleichzeitige Sandboxes; die Obergrenze liest sie bei jedem Aufruf aus dem Budget.
export const sandboxSlots = createSandboxSlots(() => getBudget(db()).maxSandboxes)
export const jevGate = () => jevBlock(db())

// Seitenleisten-Status: arbeitet / braucht dich / neu / unterbrochen je Chat. Nur Zustände.
export function chatStatus() {
  const status = sidebarStatus(db())
  return { ok: true, ...status, interrupted: interruptedAll(db()).map((run) => ({ chatId: run.chatId, runId: run.id, at: run.updatedAt })) }
}

export function chatSeen(chatId: string) {
  const own = db().prepare("select 1 from chats where id = ? and user_id = 'local'").get(chatId)
  if (!own) return { ok: false, error: "Chat nicht gefunden." }
  markSeen(db(), chatId)
  return { ok: true }
}

export const budget = () => ({ ok: true, ...budgetOverview(db(), sandboxSlots.active()) })
export function updateBudget(body: unknown) {
  const result = setBudget(db(), body)
  return result.ok ? budget() : result
}

const brainReadable = (path: string) => {
  try {
    return statSync(path).isDirectory() && readdirSync(path).length >= 0
  } catch {
    return false
  }
}

// Einrichtungs-Check. Nur Zustände und Sätze zur Abhilfe, nie Schlüsselwerte.
export function healthChecks() {
  return runHealth({
    env: process.env,
    fetch,
    clis: () => checkAllClis(),
    daytonaPing: pingDaytona,
    brainPath: () => {
      const path = localBrainPath()
      return path && existsSync(path) ? path : undefined
    },
    brainReadable,
    pluginsConfigured: async () => {
      const result = await pluginStore.catalog(new URLSearchParams({ limit: "1" }))
      return !!(result as { configured?: boolean }).configured
    },
  })
}
