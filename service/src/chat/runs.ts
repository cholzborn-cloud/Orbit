import type Database from "better-sqlite3"

import {
  addStep,
  finishRun,
  setRunStatus,
  startRun,
  type RunKind,
  type RunPayload,
} from "@/lib/work/runs"

// Hält die Tabelle work_runs im Takt mit den laufenden Turns. Fehler hier dürfen nie einen Turn stören (nur Log, ohne Inhalte).
export type RunTracker = {
  begin(input: {
    kind: RunKind
    chatId: string
    botId?: string
    rootChatId?: string
    payload?: RunPayload
  }): string | undefined
  step(id: string): void
  finish(id: string, status: "done" | "failed", error?: string): void
  // Wartet der Chat auf Consti (offene Freigabe/Rückfrage), stehen seine Jobs auf „waiting“, sonst auf „running“.
  waiting(chatId: string, waiting: boolean): void
}

export function createRunTracker(
  getDb: () => Database.Database,
  now: () => number = Date.now
): RunTracker {
  const byChat = new Map<string, Set<string>>()
  const safe = <T>(call: () => T): T | undefined => {
    try {
      return call()
    } catch {
      console.error("Job-Eintrag konnte nicht gespeichert werden.")
      return undefined
    }
  }
  return {
    begin({ kind, chatId, botId, rootChatId, payload }) {
      const parent =
        kind === "handoff" && rootChatId ? [...(byChat.get(rootChatId) ?? [])][0] : undefined
      const id = safe(() =>
        startRun(getDb(), { kind, chatId, botId, parentId: parent, payload }, now())
      )
      if (id) byChat.set(chatId, (byChat.get(chatId) ?? new Set()).add(id))
      return id
    },
    step(id) {
      safe(() => addStep(getDb(), id, now()))
    },
    finish(id, status, error) {
      safe(() => finishRun(getDb(), id, status, error, now()))
      for (const [chatId, ids] of byChat)
        if (ids.delete(id) && ids.size === 0) byChat.delete(chatId)
    },
    waiting(chatId, waiting) {
      for (const id of byChat.get(chatId) ?? [])
        safe(() => setRunStatus(getDb(), id, waiting ? "waiting" : "running", now()))
    },
  }
}
