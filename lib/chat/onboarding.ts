import { tool } from "ai"
import { z } from "zod"
import type Database from "better-sqlite3"

import { describeJob } from "../job-descriptions.ts"
import { askUserInput } from "./ask-user.ts"

// Onboarding eines neuen Orbis: ein einmaliger Turn ohne Nutzer-Nachricht. Der Hinweis hängt am Ende der Modellnachrichten
// (nie im System-Prompt, nie gespeichert); das Werkzeug gibt es nur in diesem Turn.
export const ONBOARDING_FINISH = "onboarding_finish"
export const ONBOARDING_LIMIT = 600 // Zeichen, die an die Anweisung des Orbis angehängt werden
export const INSTRUCTIONS_LIMIT = 1000 // Obergrenze der Orbi-Anweisung (Formular)

export const ONBOARDING_CREATE = "onboarding_create_orbis"
export const MAX_NEW_ORBIS = 3

type HintBot = { name: string; job: string; avatar: string; is_main?: boolean }

// Nur im Onboarding-Turn (Hinweis am Ende der Modellnachrichten, nie im Dauer-Prompt). `services` = Namen aus dem Katalog,
// also nur, was Orbit heute anbinden kann; die echte Verbindung kommt später.
export function onboardingHint(bot: HintBot, services: string[] = []) {
  const head = `[Onboarding] You were just created. Name: ${bot.name}. Task: ${bot.job}. Continue from the history; German, du-form, short.`
  if (bot.is_main) {
    const list = services.length ? services.slice(0, 6).join(", ") : "none"
    return [
      head,
      "You are the main Orbi.",
      "1. ONE sentence: introduce yourself.",
      "2. Call ask_user once with 1-2 questions about the user and his goals (main use, what should be taken off him). 2-3 options each, one recommended. Nothing after the call.",
      `3. Call ask_user with onboardingOrbiSelection=true, exactly one question "Welche Orbis soll ich anlegen?" and multiple=true. Give 2-3 options with unique Orbi names as labels and their tasks as descriptions (max 60 chars). Ask about services separately: ${list}, plus "none"; connecting follows later.`,
      `4. After that answer call ${ONBOARDING_CREATE} with ONLY the chosen Orbis (name, task, optional color #RRGGBB); never create anything unchosen. Then call ${ONBOARDING_FINISH} with 2-4 short rules from the answers (max ${ONBOARDING_LIMIT} chars). Then reply in 2-4 lines starting "So geht's weiter:" naming the new Orbis and chosen services (services are not connected yet, say so).`,
      `If skipped: call ${ONBOARDING_FINISH} with an empty string and reply with one short line.`,
    ].join("\n")
  }
  return [
    head,
    "1. ONE sentence: introduce yourself, fitted to your name and task.",
    "2. Call ask_user once with 1-2 short start questions fitted to your task (what matters most, what you must never do). 2-3 options each, one recommended. Ask nothing already said in name or task. Nothing after the call.",
    `3. After the answers call ${ONBOARDING_FINISH} with 2-4 short working rules (max ${ONBOARDING_LIMIT} chars). Then reply "So arbeite ich ab jetzt:" with 2-3 lines; if it makes sense, end with ONE question proposing your first task, fitted to the answers.`,
    `If skipped: call ${ONBOARDING_FINISH} with an empty string and reply with one short line.`,
  ].join("\n")
}

export const ORBI_QUESTION = "Welche Orbis soll ich anlegen?"
const selectionInput = z.object({
  onboardingOrbiSelection: z.literal(true),
  questions: z.tuple([z.object({
    question: z.literal(ORBI_QUESTION),
    multiple: z.literal(true),
    options: z.array(z.object({
      label: z.string().trim().min(1).max(40),
      description: z.string().trim().min(1).max(60),
      recommended: z.boolean().optional(),
    })).min(2).max(MAX_NEW_ORBIS),
  })]),
}).refine(({ questions }) => new Set(questions[0].options.map((o) => o.label.toLowerCase())).size === questions[0].options.length)

export const onboardingAskInput = z.union([
  selectionInput,
  askUserInput.extend({ onboardingOrbiSelection: z.literal(false).optional() }),
])

export type OrbiSelection = { id: string; choices: Map<string, { name: string; job: string }> }
export function reserveOrbiSelection(db: Database.Database, chatId: string, botId: string, id: string): boolean {
  const key = `onboarding-selection:${chatId}:${botId}:${id}`
  return db.prepare("insert or ignore into app_kv (key, value, updated_at) values (?, 'consumed', ?)").run(key, Date.now()).changes === 1
}
export function completeOrbiSelection(db: Database.Database, chatId: string, botId: string, id: string): void {
  const key = `onboarding-selection:${chatId}:${botId}:${id}`
  if (db.prepare("update app_kv set value = 'completed', updated_at = ? where key = ? and value = 'consumed'").run(Date.now(), key).changes !== 1)
    throw new Error("Auswahl konnte nicht abgeschlossen werden.")
}
export function isOrbiSelectionComplete(db: Database.Database, chatId: string, botId: string, id: string): boolean {
  const key = `onboarding-selection:${chatId}:${botId}:${id}`
  return (db.prepare("select value from app_kv where key = ?").get(key) as { value: string } | undefined)?.value === "completed"
}
type Part = { type: string; state?: string; toolCallId?: string; input?: unknown; output?: unknown }

// Nur eine ausdrücklich als Orbi-Auswahl angezeigte Karte kann die Anlage erlauben.
export function selectedOrbis(id: string, input: unknown, output: unknown): OrbiSelection | null {
  const parsed = selectionInput.safeParse(input)
  if (!parsed.success || !id || !output || typeof output !== "object") return null
  const answer = output as { answers?: unknown; skipped?: unknown }
  if (answer.skipped || !Array.isArray(answer.answers) || answer.answers.length !== 1) return null
  const row = answer.answers[0] as { question?: unknown; answers?: unknown } | undefined
  if (!row || row.question !== ORBI_QUESTION || !Array.isArray(row.answers) || row.answers.length === 0) return null
  const options = parsed.data.questions[0].options
  const choices = new Map<string, { name: string; job: string }>()
  for (const value of row.answers) {
    if (typeof value !== "string") return null
    const option = options.find((o) => o.label === value)
    if (!option || choices.has(option.label.toLowerCase())) return null
    choices.set(option.label.toLowerCase(), { name: option.label, job: option.description })
  }
  return { id, choices }
}

export function selectedAnswers(messages: { role?: string; parts: Part[] }[]): OrbiSelection | null {
  let selection: OrbiSelection | null = null
  for (const m of messages)
    for (const p of m.parts) {
      if (m.role !== "assistant" || p.type !== "tool-ask_user" || p.state !== "output-available") continue
      if ((p.input as { onboardingOrbiSelection?: unknown } | undefined)?.onboardingOrbiSelection !== true) continue
      selection = selectedOrbis(p.toolCallId ?? "", p.input, p.output)
    }
  return selection
}

export type NewOrbi = { name: string; job: string; color: string | null; avatar: string }
export type CreateResult = { ok: true; id: string; chatId: string } | { ok: false; error: string }

const PALETTE = ["#F5A623", "#4A90E2", "#7ED321", "#BD10E0", "#E85D75", "#50E3C2"]

// Legt die gewählten Orbis direkt an. Nur auf Auswahl: jeder Name muss unter den Antworten einer beantworteten Karte stehen.
export function createOrbisTool(deps: {
  selected: () => OrbiSelection | null
  reserve: (id: string) => Promise<boolean>
  complete: (id: string) => Promise<void>
  takenAvatars: () => string[]
  avatars: readonly string[]
  create: (orbi: NewOrbi) => Promise<CreateResult>
  created: (list: { botId: string; chatId: string; name: string }[]) => void
}) {
  let done = false
  return tool({
    description: "Onboarding only: create the Orbis the user picked on the selection card. Never unchosen ones.",
    inputSchema: z.object({
      orbis: z
        .array(
          z.object({
            name: z.string().max(40).describe("Orbi name exactly as on the card"),
            job: z.string().max(60).describe("Task, short"),
            color: z.string().optional().describe("Optional color like #4A90E2"),
          })
        )
        .min(1)
        .max(MAX_NEW_ORBIS),
    }),
    execute: async ({ orbis }) => {
      if (done) return { ok: false as const, error: "Schon angelegt." }
      const chosen = deps.selected()
      if (!chosen) return { ok: false as const, error: "Keine bestätigte Orbi-Auswahl vorhanden." }
      const names = orbis.map((o) => o.name.trim().toLowerCase())
      if (new Set(names).size !== names.length) return { ok: false as const, error: "Ein Orbi wurde mehrfach ausgewählt." }
      if (names.length !== chosen.choices.size) return { ok: false as const, error: "Bitte lege alle ausgewählten Orbis gemeinsam an." }
      const bad = orbis.find((o) => chosen.choices.get(o.name.trim().toLowerCase())?.job !== o.job.trim())
      if (bad) return { ok: false as const, error: `„${bad.name}“ wurde nicht ausgewählt.` }
      // Reservierung vor jeder externen Aktion: bei Unterbrechung ist eine neue Auswahl nötig.
      done = true
      if (!(await deps.reserve(chosen.id))) return { ok: false as const, error: "Diese Auswahl wurde bereits verwendet." }
      const used = new Set(deps.takenAvatars())
      const free = deps.avatars.filter((a) => !used.has(a))
      const made: { botId: string; chatId: string; name: string }[] = []
      for (const [i, o] of orbis.entries()) {
        const avatar = free[i % Math.max(free.length, 1)] ?? deps.avatars[i % deps.avatars.length]
        const color = o.color && /^#[0-9a-fA-F]{6}$/.test(o.color) ? o.color : PALETTE[i % PALETTE.length]
        const r = await deps.create({ name: o.name.trim(), job: o.job.trim(), color, avatar })
        if (!r.ok) {
          if (made.length) deps.created(made)
          return { ok: false as const, error: r.error, created: made.map((m) => m.name) }
        }
        made.push({ botId: r.id, chatId: r.chatId, name: o.name.trim() })
      }
      try { await deps.complete(chosen.id) }
      catch {
        if (made.length) deps.created(made)
        return { ok: false as const, error: "Die Auswahl konnte nicht abgeschlossen werden.", created: made.map((m) => m.name) }
      }
      done = true
      deps.created(made)
      return { ok: true as const, created: made.map((m) => m.name) }
    },
    toModelOutput: ({ output }) => ({
      type: "text",
      value: output.ok ? `ok: ${output.created.join(", ")}` : "created" in output && output.created
        ? `${output.error} ${output.created.length ? `Bereits angelegt: ${output.created.join(", ")}.` : "Noch kein Orbi angelegt."} Diese Auswahl ist verbraucht; für weitere Orbis eine neue Auswahl bestätigen lassen.`
        : output.error,
    }),
  })
}

export type FinishResult = { ok: true } | { ok: false; error: string }

export function createOnboardingTool(finish: (instructions: string) => Promise<FinishResult>) {
  let done = false
  return tool({
    description:
      "Finish onboarding: save the user's answers as short working rules for you, or an empty string if the user skipped.",
    inputSchema: z.object({
      instructions: z
        .string()
        .max(ONBOARDING_LIMIT)
        .describe("2-4 short rules in German, max 600 characters; empty if skipped"),
    }),
    execute: async ({ instructions }): Promise<FinishResult> => {
      if (done) return { ok: true }
      const result = await finish(instructions.trim())
      if (result.ok) done = true
      return result
    },
    toModelOutput: ({ output }) => ({ type: "text", value: output.ok ? "ok" : output.error }),
  })
}

// Hängt die Regeln an die vorhandene Anweisung an (nie überschreiben). Ist die Anweisung leer, gilt die Standardbeschreibung
// der Aufgabe als Grundlage. Passt nicht alles in die Obergrenze, wird der Anhang gekürzt; leer = keine Änderung.
export function mergeInstructions(
  current: string | null,
  bot: { job: string; is_main: boolean },
  addition: string
) {
  const text = addition.trim()
  if (!text) return current
  const base = (current?.trim() || describeJob(bot.job, bot.is_main)).trim()
  const room = INSTRUCTIONS_LIMIT - base.length - 1
  if (room < 40) return current
  return `${base}\n${text.length > room ? `${text.slice(0, room - 1).trimEnd()}…` : text}`
}
