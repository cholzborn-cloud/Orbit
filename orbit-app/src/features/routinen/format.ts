// Pure helpers for schedules and relative times (English product copy). Weekday 0 = Sunday like the service (schedule.py).
import type { Automation, Schedule } from "../../lib/types";

export type ZeitplanArt = Schedule["kind"] | "event";
/** Schedule as returned by the service; "event" (computer handed back) is not yet in the surface type. */
export type Zeitplan = Omit<Schedule, "kind" | "at"> & { kind: ZeitplanArt; at?: string };

export const WOCHENTAGE = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const WOCHENTAGE_ADV = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];
const KURZ = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const pad = (n: number) => String(n).padStart(2, "0");

/** "08:00" -> "8:00" */
export const hm = (at: string | undefined) => (at && /^\d{2}:\d{2}$/.test(at) ? `${Number(at.slice(0, 2))}:${at.slice(3)}` : "");

export const uhrzeit = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

const tagStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const tageZwischen = (a: Date, b: Date) => Math.round((tagStart(b) - tagStart(a)) / 86_400_000);

function datumKurz(iso: string | undefined): string {
  const m = iso && /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${Number(m[2])}/${Number(m[3])}` : "";
}

/** Short list label: "Mondays 8:00", "Daily 18:00", "On the 1st at 9:00". */
export function scheduleLabel(s: Zeitplan): string {
  switch (s.kind) {
    case "daily": return `Daily ${hm(s.at)}`;
    case "weekdays": return `Weekdays ${hm(s.at)}`;
    case "weekly": return `${WOCHENTAGE_ADV[s.weekday ?? 1] ?? "Weekly"} ${hm(s.at)}`;
    case "monthly": return `On the ${s.day ?? 1} at ${hm(s.at)}`;
    case "once": return `Once on ${datumKurz(s.date)} at ${hm(s.at)}`;
    case "event": return "When the computer is handed back";
  }
}

/** Sentence fragment: "every Monday at 8:00". */
export function scheduleSentence(s: Zeitplan): string {
  switch (s.kind) {
    case "daily": return `every day at ${hm(s.at)}`;
    case "weekdays": return `every weekday at ${hm(s.at)}`;
    case "weekly": return `every ${WOCHENTAGE[s.weekday ?? 1] ?? "Monday"} at ${hm(s.at)}`;
    case "monthly": return `on the ${s.day ?? 1} of each month at ${hm(s.at)}`;
    case "once": return `once on ${datumKurz(s.date)} at ${hm(s.at)}`;
    case "event": return "when the computer is handed back";
  }
}

/** "next today", "next tomorrow", "next in 4 days". */
export function nextLabel(next: string | null | undefined, now = new Date()): string {
  if (!next) return "";
  const d = new Date(next);
  if (Number.isNaN(d.getTime())) return "";
  const n = tageZwischen(now, d);
  if (n <= 0) return "next today";
  if (n === 1) return "next tomorrow";
  return `next in ${n} days`;
}

export function routineSubtitle(a: Pick<Automation, "schedule" | "enabled" | "nextRunAt" | "pausedReason">, now = new Date()): string {
  const base = scheduleLabel(a.schedule as Zeitplan);
  if (!a.enabled) return `${base} · paused`;
  const n = nextLabel(a.nextRunAt, now);
  return n ? `${base} · ${n}` : base;
}

/** "yesterday 18:00", "Mon 8:00", "today 09:15", else "11/3". */
export function lastRunText(iso: string | null | undefined, now = new Date()): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const n = tageZwischen(d, now);
  if (n === 0) return `today ${uhrzeit(d)}`;
  if (n === 1) return `yesterday ${uhrzeit(d)}`;
  if (n > 1 && n < 7) return `${KURZ[d.getDay()]} ${hm(uhrzeit(d))}`;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** Next run in local time (dialog preview); null if none. */
export function nextOccurrence(s: Zeitplan, now = new Date()): Date | null {
  if (s.kind === "event" || !s.at || !/^\d{2}:\d{2}$/.test(s.at)) return null;
  const h = Number(s.at.slice(0, 2));
  const m = Number(s.at.slice(3));
  const at = (y: number, mo: number, d: number) => new Date(y, mo, d, h, m, 0, 0);
  if (s.kind === "once") {
    const p = s.date && /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.date);
    if (!p) return null;
    const c = at(Number(p[1]), Number(p[2]) - 1, Number(p[3]));
    return c.getTime() > now.getTime() ? c : null;
  }
  if (s.kind === "monthly") {
    const day = s.day ?? 1;
    for (let k = 0; k < 14; k++) {
      const first = new Date(now.getFullYear(), now.getMonth() + k, 1);
      const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
      const c = at(first.getFullYear(), first.getMonth(), Math.min(day, last));
      if (c.getTime() > now.getTime()) return c;
    }
    return null;
  }
  for (let k = 0; k < 9; k++) {
    const c = at(now.getFullYear(), now.getMonth(), now.getDate() + k);
    if (c.getTime() <= now.getTime()) continue;
    const wd = c.getDay();
    if (s.kind === "weekdays" && (wd === 0 || wd === 6)) continue;
    if (s.kind === "weekly" && wd !== (s.weekday ?? 1)) continue;
    return c;
  }
  return null;
}

/** "today, 18:00" or "Monday, November 23". */
export function nextRunText(d: Date | null, now = new Date()): string {
  if (!d) return "no further run";
  if (tageZwischen(now, d) === 0) return `today, ${uhrzeit(d)}`;
  if (tageZwischen(now, d) === 1) return `tomorrow, ${uhrzeit(d)}`;
  return d.toLocaleDateString("en-US", { weekday: "long", day: "numeric", month: "long" });
}

/** "for 2 min" from a timestamp. */
export function seitText(iso: string | number | null | undefined, now = Date.now()): string {
  const t = typeof iso === "number" ? iso : iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(t)) return "";
  const min = Math.max(0, Math.round((now - t) / 60_000));
  if (min < 1) return "for less than 1 min";
  if (min < 60) return `for ${min} min`;
  const h = Math.round(min / 60);
  return h < 24 ? `for ${h} h` : `for ${Math.round(h / 24)} days`;
}

/** Section header from a time (ms or ISO): Today / Yesterday / Earlier. */
export function tagesGruppe(t: number, now = new Date()): "Today" | "Yesterday" | "Earlier" {
  const n = tageZwischen(new Date(t), now);
  return n <= 0 ? "Today" : n === 1 ? "Yesterday" : "Earlier";
}

/** Upcoming run for "Up next": "18:00", "tomorrow 8:00", "Mon 8:00", else "11/23". */
export function naechsteZeit(iso: string | null | undefined, now = new Date()): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const n = tageZwischen(now, d);
  if (n <= 0) return hm(uhrzeit(d));
  if (n === 1) return `tomorrow ${hm(uhrzeit(d))}`;
  if (n < 7) return `${KURZ[d.getDay()]} ${hm(uhrzeit(d))}`;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
