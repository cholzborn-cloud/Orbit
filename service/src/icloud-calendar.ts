import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { randomUUID } from "node:crypto"
import { tool, type ToolSet } from "ai"
import { z } from "zod"
import { ICloudCalendarClient, UnsupportedCalendarSeries } from "@/lib/icloud-calendar/client"
import { safeOutput } from "@/lib/connectors/client"

const keychain = promisify(execFile)
const credentials = z.object({ appleId: z.string().min(1).max(320), appPassword: z.string().regex(/^[a-z]{4}(?:-[a-z]{4}){3}$/i) })
type Credentials = z.infer<typeof credentials>

// Passwords enter the service through authenticated loopback or Keychain, never model tools.
async function readCredentials(): Promise<Credentials | null> {
  try {
    const { stdout } = await keychain("/usr/bin/security", ["find-generic-password", "-s", "de.consti.orbit.icloud-calendar", "-a", "local", "-w"], { timeout: 15_000, maxBuffer: 4096 })
    const parsed = credentials.safeParse(JSON.parse(stdout))
    return parsed.success ? parsed.data : null
  } catch { return null }
}

export async function verifyICloud(input: unknown, create = (value: Credentials) => new ICloudCalendarClient(value)) {
  const parsed = credentials.safeParse(input)
  if (!parsed.success) return { ok: false as const, error: "Apple-ID oder app-spezifisches Passwort ist ungültig." }
  try {
    const calendars = await create(parsed.data).discover()
    return { ok: true as const, count: calendars.length }
  } catch { return { ok: false as const, error: "iCloud-Kalender konnte nicht verbunden werden. Prüfe Anmeldung und Netzwerk." } }
}

export function iCloudTools(read: () => Promise<Credentials | null> = readCredentials, create = (value: Credentials) => new ICloudCalendarClient(value)): ToolSet {
  type Entry = { calendar: string; event: Awaited<ReturnType<ICloudCalendarClient["query"]>>[number] | null }
  type Page = { start: string; end: string; entries: Entry[]; nextCursor: string | null; complete: boolean }
  const snapshots: { expires: number; pages: Map<string, Page> }[] = []
  const pageOutput = (page: Page) => safeOutput(page, "Apple Kalender")
  async function client() {
    const secret = await read()
    if (!secret) throw new Error("Apple Kalender ist nicht verbunden oder der Schlüsselbund ist gesperrt.")
    const instance = create(secret)
    const calendars = await instance.discover()
    return { instance, calendars }
  }
  const eventInput = { calendar: z.string().min(1).max(200), url: z.string().url().max(2048), etag: z.string().min(2).max(258), eventTitle: z.string().min(1).max(1000), eventStart: z.string().min(1).max(500), attendees: z.array(z.string().min(1).max(2000)).max(200), series: z.boolean() }
  async function eventClient(calendar: string) {
    const result = await client()
    const matches = result.calendars.filter(c => c.name === calendar)
    if (matches.length !== 1) throw new Error("Kalendername ist nicht eindeutig oder nicht vorhanden.")
    return { instance: result.instance, calendarUrl: matches[0]!.url }
  }
  return {
    apple_calendar_list: tool({
      description: "Liest Termine aus verbundenen iCloud-Kalendern für einen Zeitraum. Bei nextCursor weitere Seiten mit demselben start und end abrufen, bis complete wahr ist. Ein event=null bezeichnet einen leeren Kalender.",
      inputSchema: z.object({ start: z.string().datetime({ offset: true }), end: z.string().datetime({ offset: true }), cursor: z.string().uuid().optional() }),
      execute: async ({ start, end, cursor }) => {
        try {
          while (snapshots.length && snapshots[0]!.expires <= Date.now()) snapshots.shift()
          if (cursor) {
            const page = snapshots.map(snapshot => snapshot.pages.get(cursor)).find(Boolean)
            return page && page.start === start && page.end === end ? pageOutput(page) : { error: "Kalenderseite ist abgelaufen oder gehört zu einem anderen Zeitraum. Bitte neu abrufen." }
          }
          if (new Date(start).getTime() >= new Date(end).getTime()) return { error: "Der Beginn muss vor dem Ende liegen." }
          const { instance, calendars } = await client()
          if (calendars.length > 100) return { error: "Zu viele Kalender. Der Abruf ist unvollständig." }
          const entries: Entry[] = []
          let bytes = 0
          for (const calendar of calendars) {
            const events = await instance.query(calendar.url, new Date(start), new Date(end))
            const rows: Entry[] = events.length ? events.map(event => ({ calendar: calendar.name, event })) : [{ calendar: calendar.name, event: null }]
            bytes += Buffer.byteLength(JSON.stringify(rows))
            if (entries.length + rows.length > 5000 || bytes > 4_000_000) return { error: "Kalenderergebnis ist zu groß und unvollständig. Bitte Zeitraum eingrenzen." }
            entries.push(...rows)
          }
          const groups: Entry[][] = [[]]
          const candidate = (rows: Entry[]): Page => ({ start, end, entries: rows, nextCursor: "00000000-0000-4000-8000-000000000000", complete: false })
          const fits = (rows: Entry[]) => {
            const page = candidate(rows)
            return Buffer.byteLength(JSON.stringify(page)) <= 5000 && JSON.stringify(pageOutput(page)).length <= 7000
          }
          for (const entry of entries) {
            let group = groups[groups.length - 1]!
            if (!fits([...group, entry])) {
              if (!group.length || !fits([entry])) return { error: "Ein Termin ist für die Ausgabe zu groß; das Ergebnis ist unvollständig. Bitte den Termin direkt im Kalender ansehen." }
              if (groups.length >= 256) return { error: "Kalenderergebnis umfasst zu viele Seiten und ist unvollständig. Bitte Zeitraum eingrenzen." }
              group = []; groups.push(group)
            }
            group.push(entry)
          }
          const cursors = groups.map(() => randomUUID())
          const pages = groups.map((entries, i): Page => ({ start, end, entries, nextCursor: cursors[i + 1] ?? null, complete: i === groups.length - 1 }))
          if (pages.length > 1) {
            while (snapshots.length >= 4) snapshots.shift()
            snapshots.push({ expires: Date.now() + 300_000, pages: new Map(pages.slice(1).map((page, i) => [cursors[i + 1]!, page])) })
          }
          return pageOutput(pages[0]!)
        } catch { return { error: "Apple Kalender konnte nicht vollständig gelesen werden. Prüfe Verbindung und Zeitraum oder grenze den Zeitraum ein." } }
      },
    }),
    apple_calendar_create: tool({
      description: "Erstellt einen eigenen Termin im benannten iCloud-Kalender, ohne Einladungen.",
      inputSchema: z.object({ calendar: z.string().min(1).max(200), title: z.string().min(1).max(1000), start: z.string().datetime({ offset: true }), end: z.string().datetime({ offset: true }) }),
      execute: async ({ calendar, title, start, end }) => {
        try {
          const { instance, calendars } = await client()
          const matches = calendars.filter(c => c.name === calendar)
          if (matches.length !== 1) return { error: "Kalendername ist nicht eindeutig oder nicht vorhanden." }
          await instance.createEvent(matches[0].url, { title, start: new Date(start), end: new Date(end) })
          return { ok: true, message: "Termin wurde angelegt." }
        } catch { return { error: "Der Termin konnte nicht bestätigt werden. Bitte zuerst im Kalender prüfen, bevor du es erneut versuchst." } }
      },
    }),
    apple_calendar_update: tool({
      description: "Ändert eigenen Termin oder einfache UTC-Serie; ausgeschlossene und zusätzlich eingetragene UTC-Termine können mitverschoben werden. Beim Umbenennen bleiben abweichende Einzeltermine unverändert. URL, ETag, alten Titel, DTSTART, alle ATTENDEE-Zeilen und Serienumfang aus der Kalenderliste verwenden.",
      inputSchema: z.object({ ...eventInput, title: z.string().min(1).max(1000), start: z.string().datetime({ offset: true }), end: z.string().datetime({ offset: true }) }),
      execute: async ({ calendar, url, etag, eventTitle, eventStart, attendees, series, title, start, end }) => {
        try { const c = await eventClient(calendar); await c.instance.updateEvent(c.calendarUrl, url, etag, eventTitle, eventStart, { title, start: new Date(start), end: new Date(end) }, attendees, series); return { ok: true, message: "Termin wurde geändert." } }
        catch (error) { return { error: error instanceof UnsupportedCalendarSeries ? "Diese Terminserie kann nicht sicher geändert werden. Bitte bearbeite sie im Kalender." : "Termin konnte nicht geändert werden. Prüfe den Termin und seine Version im Kalender, bevor du es erneut versuchst." } }
      },
    }),
    apple_calendar_delete: tool({
      description: "Löscht einen eigenen Termin oder eine ganze Serie nach Freigabe. Verwende URL, ETag, bisherigen Titel, vollständige DTSTART- und alle ATTENDEE-Zeilen sowie Serienumfang aus der Kalenderliste.",
      inputSchema: z.object(eventInput),
      execute: async ({ calendar, url, etag, eventTitle, eventStart, attendees, series }) => {
        try { const c = await eventClient(calendar); await c.instance.deleteEvent(c.calendarUrl, url, etag, eventTitle, eventStart, attendees, series); return { ok: true, message: "Termin wurde gelöscht." } }
        catch { return { error: "Löschung konnte nicht bestätigt werden. Prüfe zuerst den Kalender, bevor du es erneut versuchst." } }
      },
    }),
    apple_calendar_invite: tool({
      description: "Lädt eine Person zu einem eigenen Termin oder einer ganzen Serie ohne Ausnahmen ein. Verwende URL, ETag, bisherigen Titel, vollständige DTSTART- und alle ATTENDEE-Zeilen sowie Serienumfang aus der Kalenderliste.",
      inputSchema: z.object({ ...eventInput, recipient: z.string().email().max(254) }),
      execute: async ({ calendar, url, etag, eventTitle, eventStart, attendees, series, recipient }) => {
        try { const c = await eventClient(calendar); await c.instance.inviteEvent(c.calendarUrl, url, etag, eventTitle, eventStart, recipient, attendees, series); return { ok: true, message: "Einladung wurde beim Kalender eingereicht." } }
        catch (error) { return { error: error instanceof UnsupportedCalendarSeries ? "Einladungen zu dieser Terminserie werden noch nicht unterstützt. Bitte bearbeite sie im Kalender." : "Einladung konnte nicht bestätigt werden. Prüfe zuerst den Kalender, bevor du es erneut versuchst." } }
      },
    }),
  }
}
