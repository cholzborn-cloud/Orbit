import { tool } from "ai"
import { z } from "zod"

const taskSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("list"), list: z.string().trim().min(1).max(200).optional() }),
  z.object({ kind: z.literal("create"), title: z.string().trim().min(1).max(500), list: z.string().trim().min(1).max(200).optional(), due: z.string().datetime({ offset: true }).optional() }),
])
export type ReminderTask = z.infer<typeof taskSchema>
const resultSchema = z.union([
  z.object({ ok: z.literal(true), items: z.array(z.object({ title: z.string().max(500), list: z.string().max(200), due: z.string().max(64).nullable(), completed: z.boolean() })).max(100).optional(), truncated: z.boolean().optional() }),
  z.object({ ok: z.literal(false), error: z.string().max(500) }),
])
type Result = z.infer<typeof resultSchema>

// Jeder Auftrag wird höchstens einmal an eine App übergeben; bei Timeout ist das Ergebnis ausdrücklich unklar.
export class ReminderBridge {
  private pending = new Map<string, { task: ReminderTask; claimed: boolean; finish: (value: Result) => void }>()
  onAvailable?: () => void
  onCancel?: (id: string) => void
  constructor(private timeoutMs = 90_000) {}

  submit(task: ReminderTask, signal?: AbortSignal): Promise<Result> {
    if (this.pending.size >= 16) return Promise.resolve({ ok: false, error: "Zu viele offene Erinnerungsaufträge." })
    if (signal?.aborted) return Promise.resolve({ ok: false, error: "Auftrag abgebrochen." })
    return new Promise((resolve) => {
      const id = crypto.randomUUID()
      const finish = (value: Result) => {
        clearTimeout(timer)
        signal?.removeEventListener("abort", abort)
        this.pending.delete(id)
        resolve(value)
      }
      const uncertain = () => ({ ok: false as const, error: "Ergebnis nicht bestätigt. Prüfe Erinnerungen, bevor du es erneut versuchst." })
      const abandon = (aborted: boolean) => {
        const claimed = this.pending.get(id)?.claimed === true
        if (claimed) this.onCancel?.(id)
        finish(claimed || !aborted ? uncertain() : { ok: false, error: "Auftrag abgebrochen." })
      }
      const abort = () => abandon(true)
      const timer = setTimeout(() => abandon(false), this.timeoutMs)
      this.pending.set(id, { task, claimed: false, finish })
      signal?.addEventListener("abort", abort, { once: true })
      this.onAvailable?.()
    })
  }

  claim() {
    for (const [id, entry] of this.pending) {
      if (!entry.claimed) { entry.claimed = true; return { id, task: entry.task } }
    }
    return null
  }

  isActive(id: string): boolean { return this.pending.get(id)?.claimed === true }

  complete(id: string, input: unknown): boolean {
    const entry = this.pending.get(id)
    const result = resultSchema.safeParse(input)
    if (!entry?.claimed || !result.success) return false
    entry.finish(result.data)
    return true
  }
}

export const reminders = new ReminderBridge()
export function reminderTools(bridge = reminders) {
  return {
    apple_reminders_list: tool({
      description: "Liest bis zu 100 Erinnerungen aus Apple Erinnerungen, optional aus einer benannten Liste.",
      inputSchema: taskSchema.options[0].omit({ kind: true }),
      execute: (input, options) => bridge.submit({ kind: "list", ...input }, options.abortSignal),
    }),
    apple_reminders_create: tool({
      description: "Legt eine Erinnerung in Apple Erinnerungen an, optional mit Liste und Fälligkeit.",
      inputSchema: taskSchema.options[1].omit({ kind: true }),
      execute: (input, options) => bridge.submit({ kind: "create", ...input }, options.abortSignal),
    }),
  }
}
