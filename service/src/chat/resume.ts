import type { UIMessage } from "ai"
import type Database from "better-sqlite3"

import { readLine } from "@/lib/chat/orbi-message"
import { getRun, interruptedFor, rootOf, settleInterrupted, type WorkRun } from "@/lib/work/runs"

// „Weiter“ nach einem Neustart (Phase 5): startet den unterbrochenen Turn mit der letzten Nachricht von Consti neu
// (wie „Antwort wiederholen“: eine angefangene Antwort wird ersetzt).
export type ResumeOptions = {
  getDb: () => Database.Database
  listMessages: (chatId: string) => Promise<UIMessage[]>
  // Merkt sich den Auftrag des unterbrochenen Turns, damit seine Zähler im neuen Turn weiterlaufen.
  noteResume: (chatId: string, taskId: string) => void
}

export type ResumePrepared =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; error: string; status: 404 | 409 }

// Der jüngste Turn eines Chats (auch beendet): dort steht, mit welchem Orbi und Modell Consti geschrieben hat.
function latestTurn(db: Database.Database, chatId: string): WorkRun | null {
  const row = db.prepare("select id from work_runs where chat_id = ? and kind = 'turn' order by started_at desc limit 1").get(chatId) as
    | { id: string }
    | undefined
  return row ? getRun(db, row.id) : null
}

export function createResume({ getDb, listMessages, noteResume }: ResumeOptions) {
  return {
    // Anzeige im Chat: der offene Unterbrochen-Hinweis (oder null).
    interrupted(chatId: string) {
      const run = interruptedFor(getDb(), chatId)
      return run ? { runId: run.id, at: run.updatedAt, startedAt: run.startedAt, steps: run.steps } : null
    },
    async prepare(chatId: string, runId: string): Promise<ResumePrepared> {
      const run = getRun(getDb(), runId)
      if (!run || rootOf(run) !== chatId)
        return { ok: false, error: "Unterbrochene Arbeit nicht gefunden.", status: 404 }
      if (run.status !== "interrupted")
        return { ok: false, error: "Diese Arbeit ist nicht unterbrochen.", status: 409 }
      const messages = await listMessages(chatId)
      const last = messages.findLast((m) => m.role === "user" && !readLine(m))
      if (!last) return { ok: false, error: "Keine Nachricht zum Fortsetzen vorhanden.", status: 409 }
      // Übergabe: neu gestartet wird der Turn, in dem Consti geschrieben hat; Modell und Orbi kommen von dort, die Zähler vom gemeinsamen Auftrag.
      const root: WorkRun | null = run.kind === "turn" ? run : latestTurn(getDb(), chatId)
      const p = root?.payload ?? {}
      const taskId = run.payload.taskId ?? p.taskId
      if (taskId) noteResume(chatId, taskId)
      return {
        ok: true,
        body: {
          messages: [last],
          trigger: "regenerate-message",
          messageId: last.id,
          clientData: {
            model: p.model ?? "auto",
            ...(p.effort ? { effort: p.effort } : {}),
            context: p.context ?? true,
            ...(p.modelPinned ? { modelPinned: true } : {}),
            ...(root?.botId ? { botId: root.botId } : {}),
            ...(p.skill?.name && (p.skill.source === "orbit" || p.skill.source === "brain")
              ? { skill: { name: p.skill.name, source: p.skill.source } }
              : {}),
          },
        },
      }
    },
    // Der neue Turn läuft: der Hinweis verschwindet.
    started(runId: string) {
      settleInterrupted(getDb(), runId, "fortgesetzt")
    },
    dismiss(chatId: string, runId: string) {
      const run = getRun(getDb(), runId)
      return !!run && rootOf(run) === chatId && settleInterrupted(getDb(), runId, "verworfen")
    },
  }
}
export type Resume = ReturnType<typeof createResume>
