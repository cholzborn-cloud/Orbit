import { z } from "zod"

export const scheduleSchema = z
  .discriminatedUnion("kind", [
    z.object({
      kind: z.literal("once"),
      at: z.string().regex(/^\d{2}:\d{2}$/),
      date: z.string().date(),
    }),
    z.object({
      kind: z.literal("daily"),
      at: z.string().regex(/^\d{2}:\d{2}$/),
    }),
    z.object({
      kind: z.literal("weekdays"),
      at: z.string().regex(/^\d{2}:\d{2}$/),
    }),
    z.object({
      kind: z.literal("weekly"),
      at: z.string().regex(/^\d{2}:\d{2}$/),
      weekday: z.number().int().min(0).max(6).describe("0 = Sunday"),
    }),
    z.object({
      kind: z.literal("monthly"),
      at: z.string().regex(/^\d{2}:\d{2}$/),
      day: z.number().int().min(1).max(31),
    }),
  ])
  .superRefine((s, ctx) => {
    const [h, m] = s.at.split(":").map(Number)
    if (h > 23 || m > 59)
      ctx.addIssue({ code: "custom", message: "Uhrzeit ist ungültig." })
  })

export type Schedule = z.infer<typeof scheduleSchema>
const timezoneSchema = z.string().refine((value) => {
  try {
    new Intl.DateTimeFormat("de-DE", { timeZone: value })
    return true
  } catch {
    return false
  }
}, "Zeitzone ist ungültig.")

export const automationInput = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Name muss mindestens 2 Zeichen haben.")
    .max(60, "Name darf höchstens 60 Zeichen haben."),
  prompt: z
    .string()
    .trim()
    .min(1, "Prompt fehlt.")
    .max(4000, "Prompt darf höchstens 4000 Zeichen haben."),
  schedule: scheduleSchema,
  timezone: timezoneSchema,
  target: z.enum(["same", "new"]).default("same"),
  notify: z.enum(["app", "none"]).default("app"),
  model: z.string().max(80).nullish(),
  effort: z.string().max(20).nullish(),
  context: z.boolean().default(true),
})

const parts = (date: Date, timezone: string) =>
  Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map(({ type, value }) => [type, value])
  ) as Record<string, string>

function zonedDate(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  timezone: string
) {
  const wanted = Date.UTC(y, mo - 1, d, h, mi)
  let candidate = wanted
  for (let i = 0; i < 4; i++) {
    const p = parts(new Date(candidate), timezone)
    const represented = Date.UTC(
      +p.year,
      +p.month - 1,
      +p.day,
      +p.hour,
      +p.minute
    )
    candidate += wanted - represented
  }
  const p = parts(new Date(candidate), timezone)
  return +p.year === y &&
    +p.month === mo &&
    +p.day === d &&
    +p.hour === h &&
    +p.minute === mi
    ? new Date(candidate)
    : null
}

export function nextRun(
  schedule: Schedule,
  timezone: string,
  from: Date
): Date | null {
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone })
  } catch {
    return null
  }
  const [hour, minute] = schedule.at.split(":").map(Number)
  const here = parts(from, timezone)
  const base = new Date(Date.UTC(+here.year, +here.month - 1, +here.day))
  const onceOffset =
    schedule.kind === "once" && schedule.date
      ? Math.floor(
          (Date.parse(`${schedule.date}T00:00:00Z`) - base.getTime()) /
            86_400_000
        )
      : 0
  if (schedule.kind === "once" && onceOffset < 0) return null
  const limit = schedule.kind === "once" ? onceOffset + 1 : 367
  for (let offset = 0; offset < limit; offset++) {
    const day = new Date(base.getTime() + offset * 86_400_000)
    const y = day.getUTCFullYear(),
      mo = day.getUTCMonth() + 1,
      d = day.getUTCDate()
    if (
      schedule.kind === "once" &&
      `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}` !==
        schedule.date
    )
      continue
    const weekday = day.getUTCDay()
    if (schedule.kind === "weekdays" && (weekday === 0 || weekday === 6))
      continue
    if (schedule.kind === "weekly" && weekday !== schedule.weekday) continue
    if (
      schedule.kind === "monthly" &&
      d !== Math.min(schedule.day, new Date(Date.UTC(y, mo, 0)).getUTCDate())
    )
      continue
    const candidate = zonedDate(y, mo, d, hour, minute, timezone)
    if (candidate && candidate > from) return candidate
  }
  return null
}

export const validateMinInterval = (lastRunAt: Date | null, now: Date) =>
  !lastRunAt || now.getTime() - lastRunAt.getTime() >= 5 * 60_000
export const validateManualRun = validateMinInterval
export const isDue = (
  enabled: boolean,
  deletedAt: Date | null,
  pausedReason: string | null,
  next: Date | null,
  now: Date
) => enabled && !deletedAt && !pausedReason && !!next && next <= now
export const shouldAutoPause = (lastUserMessageAt: Date | null, now: Date) =>
  !!lastUserMessageAt &&
  now.getTime() - lastUserMessageAt.getTime() >= 14 * 86_400_000

export const shouldSkipAutoPause = (
  resumedAt: Date | null,
  lastRunAt: Date | null
) => !!resumedAt && (!lastRunAt || lastRunAt < resumedAt)
export function afterFailedRun(
  schedule: Schedule,
  timezone: string,
  now: Date
) {
  const following = nextRun(schedule, timezone, now)
  return {
    following,
    disable: schedule.kind === "once" && following === null,
  }
}
export const keepLatestRuns = <T>(runs: T[]) => runs.slice(0, 20)

// Intervall-Aufgabe des Dienstes (Phase 5, Heartbeat): „alle N Minuten im Zeitfenster“. Bewusst nicht Teil von `scheduleSchema`:
// Nutzer-Automationen bieten diese Art nicht an. Fälligkeit und Mac-Aktivität prüft der Aufrufer.
export const everySchedule = z.object({
  kind: z.literal("every"),
  minutes: z.number().int().min(5).max(1440),
  from: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  to: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
})
export type EverySchedule = z.infer<typeof everySchedule>

// Liegt der Zeitpunkt im Zeitfenster [from, to) der Zeitzone? from == to heißt ganztägig; to < from geht über Mitternacht.
export function inWindow(schedule: EverySchedule, at: Date, timezone: string): boolean {
  const here = parts(at, timezone)
  const now = +here.hour * 60 + +here.minute
  const [fh, fm] = schedule.from.split(":").map(Number)
  const [th, tm] = schedule.to.split(":").map(Number)
  const from = fh * 60 + fm
  const to = th * 60 + tm
  if (from === to) return true
  return from < to ? now >= from && now < to : now >= from || now < to
}

// Nächster Termin nach `from`. Das Zeitfenster gilt erst beim Ausführen (ein Termin außerhalb wartet, bis das Fenster offen ist).
export function nextEvery(schedule: EverySchedule, from: Date): Date {
  return new Date(from.getTime() + schedule.minutes * 60_000)
}
