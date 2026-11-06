import { randomUUID } from "node:crypto";
import { child, children, parseXml, type XmlNode } from "./xml.ts";

const DAV = "DAV:|", CAL = "urn:ietf:params:xml:ns:caldav|";
const MAX_BYTES = 2 * 1024 * 1024;
const XML_START = '<?xml version="1.0" encoding="utf-8"?>';
const namespaces = 'xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"';
export class UnsupportedCalendarSeries extends Error {}
export interface Calendar { url: string; name: string }
export interface CalendarObject { url: string; etag: string | null; iCalendar: string }
export type CalendarTransport = (url: string, init: RequestInit) => Promise<Response>;

function appleUrl(value: string, base?: string): URL {
  let url: URL;
  try { url = new URL(value, base); } catch { throw new Error("Ungültiges Kalenderziel."); }
  if (url.protocol !== "https:" || url.port || url.username || url.password || url.hash || url.search ||
    !(url.hostname === "caldav.icloud.com" || /^p\d+-caldav\.icloud\.com$/.test(url.hostname))) {
    throw new Error("Kalenderziel ist kein erlaubter iCloud-CalDAV-Server.");
  }
  return url;
}

function props(response: XmlNode): XmlNode[] {
  return children(response, DAV + "propstat").filter(stat => /^HTTP\/\d(?:\.\d)? 200(?: |$)/.test(child(stat, DAV + "status")?.text.trim() ?? ""))
    .flatMap(stat => children(stat, DAV + "prop"));
}
function property(response: XmlNode, name: string): XmlNode | undefined {
  return props(response).flatMap(prop => children(prop, name))[0];
}
function utc(date: Date): string {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime()) || date.getUTCFullYear() < 1000 || date.getUTCFullYear() > 9999) throw new Error("Ungültiges Kalenderdatum.");
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function foldCalendar(lines: string[]): string {
  return lines.map(line => {
    let output = "", count = 0;
    for (const character of line) { const bytes = Buffer.byteLength(character); if (count + bytes > 75) { output += "\r\n "; count = 1; } output += character; count += bytes; }
    return output;
  }).join("\r\n") + "\r\n";
}

/** Server-side only. Credentials are held in memory; callers own Keychain storage and approvals. */
export class ICloudCalendarClient {
  #authorization: string;
  #transport: CalendarTransport;
  #owner: string;
  #calendars = new Set<string>();
  constructor(credentials: { appleId: string; appPassword: string }, transport: CalendarTransport = fetch) {
    if (!credentials.appleId || credentials.appleId.length > 320 || /[:\r\n\0]/.test(credentials.appleId) ||
      !/^[a-z]{4}(?:-[a-z]{4}){3}$/i.test(credentials.appPassword)) throw new Error("Apple-ID und app-spezifisches Passwort erforderlich.");
    this.#owner = credentials.appleId;
    this.#authorization = `Basic ${Buffer.from(`${credentials.appleId}:${credentials.appPassword}`).toString("base64")}`;
    this.#transport = transport;
  }

  async #request(target: string, method: string, body: string, headers: Record<string, string> = {}) {
    let url = appleUrl(target);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      for (let redirects = 0; redirects <= 3; redirects++) {
        const response = await this.#transport(url.href, { method, ...(!["GET", "DELETE"].includes(method) ? { body } : {}), headers: {
          Authorization: this.#authorization, "Content-Type": "application/xml; charset=utf-8", ...headers,
        }, redirect: "manual", signal: controller.signal });
        // A transport that auto-follows redirects cannot provide the required credential boundary.
        if (response.redirected) { await response.body?.cancel(); throw new Error("Unerwartete automatische Kalenderweiterleitung."); }
        if ([301, 302, 307, 308].includes(response.status)) {
          await response.body?.cancel();
          const location = response.headers.get("location");
          if (!location || redirects === 3 || ["PUT", "DELETE"].includes(method)) throw new Error("Kalenderweiterleitung abgebrochen.");
          url = appleUrl(location, url.href); continue;
        }
        if (![200, 201, 204, 207].includes(response.status)) {
          await response.body?.cancel();
          throw new Error(`iCloud-Kalender antwortet mit HTTP ${response.status}.`);
        }
        const reader = response.body?.getReader();
        const chunks: Uint8Array[] = []; let size = 0;
        if (reader) {
          try {
            while (true) {
              const next = await reader.read(); if (next.done) break;
              size += next.value.byteLength;
              if (size > MAX_BYTES) throw new Error("Kalenderantwort ist zu groß.");
              chunks.push(next.value);
            }
          } catch (error) { await reader.cancel().catch(() => {}); throw error; }
          finally { reader.releaseLock(); }
        }
        return { url: url.href, status: response.status, text: new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)), etag: response.headers.get("etag") };
      }
      throw new Error("Zu viele Kalenderweiterleitungen.");
    } catch {
      // Never propagate provider/transport errors: they can contain URLs, headers or passwords.
      throw new Error("Kalenderanfrage fehlgeschlagen oder Zeitlimit erreicht.");
    } finally { clearTimeout(timer); }
  }

  async #propfind(url: string, properties: string, depth: "0" | "1") {
    const result = await this.#request(url, "PROPFIND", `${XML_START}<d:propfind ${namespaces}><d:prop>${properties}</d:prop></d:propfind>`, { Depth: depth });
    const root = parseXml(result.text);
    if (result.status !== 207 || root.name !== DAV + "multistatus") throw new Error("Ungültige CalDAV-Discovery-Antwort.");
    return { url: result.url, responses: children(root, DAV + "response") };
  }

  /** A successful discovery is the minimum evidence for a connected account; not a write-permission check. */
  async discover(): Promise<Calendar[]> {
    this.#calendars.clear();
    const principalResult = await this.#propfind("https://caldav.icloud.com/.well-known/caldav", "<d:current-user-principal/>", "0");
    const principalHref = principalResult.responses.map(row => child(property(row, DAV + "current-user-principal") ?? { name: "", text: "", children: [] }, DAV + "href")?.text.trim()).find(Boolean);
    if (!principalHref) throw new Error("iCloud-Kalenderkonto wurde nicht erkannt.");
    const principal = appleUrl(principalHref, principalResult.url).href;
    const homeResult = await this.#propfind(principal, "<c:calendar-home-set/>", "0");
    const homes = homeResult.responses.flatMap(row => children(property(row, CAL + "calendar-home-set") ?? { name: "", text: "", children: [] }, DAV + "href"));
    if (!homes.length || homes.length > 8) throw new Error("Kalenderverzeichnis fehlt oder ist zu groß.");
    const calendars: Calendar[] = [];
    for (const home of homes) {
      const result = await this.#propfind(appleUrl(home.text.trim(), homeResult.url).href, "<d:resourcetype/><d:displayname/>", "1");
      for (const row of result.responses) {
        if (!property(row, DAV + "resourcetype")?.children.some(type => type.name === CAL + "calendar")) continue;
        const href = child(row, DAV + "href")?.text.trim();
        if (!href) throw new Error("Kalenderadresse fehlt.");
        const url = appleUrl(href, result.url).href;
        if (!url.endsWith("/")) throw new Error("Ungültige Kalenderadresse.");
        if (!calendars.some(calendar => calendar.url === url)) calendars.push({ url, name: property(row, DAV + "displayname")?.text ?? "Kalender" });
      }
    }
    this.#calendars = new Set(calendars.map(calendar => calendar.url));
    return calendars;
  }

  #calendar(url: string): string {
    const canonical = appleUrl(url).href;
    if (!this.#calendars.has(canonical)) throw new Error("Kalender muss zuerst über dieses Konto ermittelt werden.");
    return canonical;
  }

  /** Returns complete raw objects, including recurrence definitions; does not expand recurrences. */
  async query(calendarUrl: string, start: Date, end: Date): Promise<CalendarObject[]> {
    const from = utc(start), to = utc(end);
    if (to <= from || end.getTime() - start.getTime() > 366 * 86400000) throw new Error("Kalenderzeitraum muss zwischen einer Sekunde und 366 Tagen liegen.");
    const url = this.#calendar(calendarUrl);
    const result = await this.#request(url, "REPORT", `${XML_START}<c:calendar-query ${namespaces}><d:prop><d:getetag/><c:calendar-data/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range start="${from}" end="${to}"/></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`, { Depth: "1" });
    const root = parseXml(result.text);
    if (result.status !== 207 || root.name !== DAV + "multistatus") throw new Error("Ungültige Kalenderabfrage-Antwort.");
    return children(root, DAV + "response").flatMap(row => {
      const data = property(row, CAL + "calendar-data");
      if (!data?.text.trim()) throw new Error("Kalenderobjekt fehlt; das Ergebnis ist unvollständig.");
      const href = child(row, DAV + "href")?.text.trim();
      if (!href) throw new Error("Kalenderobjekt-Adresse fehlt.");
      const objectUrl = appleUrl(href, result.url).href;
      if (!objectUrl.startsWith(url) || objectUrl.slice(url.length).includes("/")) throw new Error("Kalenderobjekt liegt außerhalb des gewählten Kalenders.");
      return [{ url: objectUrl, etag: property(row, DAV + "getetag")?.text ?? null, iCalendar: data.text }];
    });
  }

  /** Caller applies Orbit's existing action rules. One own UTC event, no invitations. Never auto-retry after timeout. */
  async createEvent(calendarUrl: string, event: { title: string; start: Date; end: Date }): Promise<{ url: string; etag: string | null }> {
    const url = this.#calendar(calendarUrl);
    if (typeof event.title !== "string" || !event.title.trim() || event.title.length > 1000 || /[\x00-\x1f\x7f]/.test(event.title)) throw new Error("Ungültiger Kalendertitel.");
    const from = utc(event.start), to = utc(event.end);
    if (to <= from) throw new Error("Terminende muss mindestens eine Sekunde nach dem Beginn liegen.");
    const uid = randomUUID();
    const summary = "SUMMARY:" + event.title.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,");
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Orbit//iCloud Calendar//DE", "BEGIN:VEVENT", `UID:${uid}`, `DTSTAMP:${utc(new Date())}`, `DTSTART:${from}`, `DTEND:${to}`, summary, "END:VEVENT", "END:VCALENDAR"];
    const fold = (line: string) => {
      let output = "", count = 0;
      for (const character of line) { const bytes = Buffer.byteLength(character); if (count + bytes > 75) { output += "\r\n "; count = 1; } output += character; count += bytes; }
      return output;
    };
    const objectUrl = new URL(`${uid}.ics`, url).href;
    const result = await this.#request(objectUrl, "PUT", lines.map(fold).join("\r\n") + "\r\n", { "Content-Type": "text/calendar; charset=utf-8", "If-None-Match": "*" });
    if (result.status !== 201 && result.status !== 204) throw new Error("Terminerstellung wurde nicht bestätigt.");
    return { url: objectUrl, etag: result.etag };
  }

  // Der freigegebene Stand wird vor jeder Änderung mit dem per ETag gesicherten Kalenderobjekt verglichen.
  async #event(calendarUrl: string, objectUrl: string, etag: string, title: string, expectedStart: string, expectedAttendees: string[], expectedSeries: boolean) {
    const calendar = this.#calendar(calendarUrl);
    const url = appleUrl(objectUrl).href;
    const name = url.startsWith(calendar) ? url.slice(calendar.length) : "";
    if (!/^[A-Za-z0-9._~-]+\.ics$/i.test(name) || !/^"[^"\r\n]{1,256}"$/.test(etag)) throw new Error("Terminadresse oder Version ungültig.");
    const result = await this.#request(url, "GET", "");
    if (result.url !== url || result.etag !== etag) throw new Error("Termin wurde inzwischen geändert.");
    const lines = result.text.replace(/\r\n[ \t]/g, "").split(/\r\n/).filter(Boolean);
    if (lines.some(line => /[\r\n\0]/.test(line))) throw new Error("Terminformat nicht unterstützt.");
    const stack: string[] = [];
    const events: { start: number; end: number; indexes: number[] }[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const begin = /^BEGIN:([A-Z0-9-]+)$/i.exec(line);
      const end = /^END:([A-Z0-9-]+)$/i.exec(line);
      if (begin) {
        const component = begin[1]!.toUpperCase();
        if (!stack.length && (component !== "VCALENDAR" || i !== 0)) throw new Error("Ungültiger Kalender.");
        if (component === "VEVENT") {
          if (stack.length !== 1 || stack[0] !== "VCALENDAR") throw new Error("Ungültiger Termin.");
          events.push({ start: i, end: -1, indexes: [] });
        }
        stack.push(component);
      } else if (end) {
        const component = end[1]!.toUpperCase();
        if (stack.pop() !== component) throw new Error("Ungültiger Kalender.");
        if (component === "VEVENT") events.at(-1)!.end = i;
        if (!stack.length && i !== lines.length - 1) throw new Error("Ungültiger Kalender.");
      } else if (stack.length === 2 && stack[1] === "VEVENT") events.at(-1)!.indexes.push(i);
    }
    if (stack.length || !events.length || lines[0] !== "BEGIN:VCALENDAR" || lines.at(-1) !== "END:VCALENDAR" || events.some(e => e.end < e.start)) throw new Error("Ungültiger Kalender.");
    const fields = (event: typeof events[number], name: string) => event.indexes.map(i => lines[i]!).filter(line => new RegExp(`^${name}(?:;[^:]*)?:`, "i").test(line));
    const masters = events.filter(event => !fields(event, "RECURRENCE-ID").length);
    if (masters.length !== 1) throw new Error("Terminserie hat keinen eindeutigen Haupttermin.");
    const master = masters[0]!;
    if (["UID", "SUMMARY", "DTSTART", "DTEND"].some(field => fields(master, field).length !== 1)) throw new Error("Termin ist nicht eindeutig.");
    const uid = fields(master, "UID")[0]!;
    if (events.some(event => fields(event, "UID").length !== 1 || fields(event, "UID")[0] !== uid)) throw new Error("Terminserie ist nicht eindeutig.");
    const series = events.length > 1 || events.some(event => ["RRULE", "RDATE", "EXDATE", "RECURRENCE-ID"].some(field => fields(event, field).length));
    if (series !== expectedSeries) throw new Error("Serienumfang stimmt nicht mit der Freigabe überein.");
    const attendees = events.flatMap(event => fields(event, "ATTENDEE"));
    if (attendees.length !== expectedAttendees.length || [...attendees].sort().some((line, i) => line !== [...expectedAttendees].sort()[i])) throw new Error("Teilnehmer stimmen nicht mit der Freigabe überein.");
    for (const event of events) {
      const organizers = fields(event, "ORGANIZER");
      if (organizers.length > 1 || (organizers.length === 1 && organizers[0]!.slice(organizers[0]!.indexOf(":") + 1).toLowerCase() !== `mailto:${this.#owner.toLowerCase()}`) || (fields(event, "ATTENDEE").length && !organizers.length)) throw new Error("Nur eigene Termine werden unterstützt.");
    }
    const summaryLine = fields(master, "SUMMARY")[0]!;
    const summary = summaryLine.slice(summaryLine.indexOf(":") + 1).replace(/\\([\\,;])/g, "$1").replace(/\\[nN]/g, "\n");
    if (summary !== title || fields(master, "DTSTART")[0] !== expectedStart) throw new Error("Termin stimmt nicht mit der Freigabe überein.");
    return { url, lines, master, fields: (name: string) => fields(master, name), series, eventCount: events.length,
      recurrenceIds: events.filter(event => event !== master).flatMap(event => fields(event, "RECURRENCE-ID")) };
  }

  async updateEvent(calendarUrl: string, objectUrl: string, etag: string, expectedTitle: string, expectedStart: string, change: { title: string; start: Date; end: Date }, expectedAttendees: string[] = [], expectedSeries = false): Promise<void> {
    if (!change.title.trim() || change.title.length > 1000 || /[\x00-\x1f\x7f]/.test(change.title)) throw new Error("Ungültiger Kalendertitel.");
    const from = utc(change.start), to = utc(change.end);
    if (to <= from) throw new Error("Ungültiger Zeitraum.");
    const event = await this.#event(calendarUrl, objectUrl, etag, expectedTitle, expectedStart, expectedAttendees, expectedSeries);
    let shiftedUntil: string | undefined;
    const shiftedDates = new Map<string, string>();
    if (event.series) {
      const start = event.fields("DTSTART")[0]!, end = event.fields("DTEND")[0]!;
      const unchanged = start === `DTSTART:${from}` && end === `DTEND:${to}`;
      const rules = event.fields("RRULE");
      // shortcut: Zeitänderungen nur für einfache UTC-Regeln; bei vollständiger Serienbearbeitung erweitern.
      const parts = rules.length === 1 && /^RRULE:/i.test(rules[0]!) ? rules[0]!.slice(6).toUpperCase().split(";") : [];
      const keys = parts.map(part => part.split("=")[0]);
      const simpleRule = keys.includes("FREQ") && new Set(keys).size === keys.length && !(keys.includes("COUNT") && keys.includes("UNTIL")) && parts.every(part => /^(FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)|INTERVAL=[1-9]\d*|COUNT=[1-9]\d*|UNTIL=\d{8}T\d{6}Z|BYDAY=(MO|TU|WE|TH|FR|SA|SU)(,(MO|TU|WE|TH|FR|SA|SU))*)$/.test(part));
      const safeTimeChange = simpleRule && !expectedAttendees.length && /^DTSTART:\d{8}T\d{6}Z$/.test(start) && /^DTEND:\d{8}T\d{6}Z$/.test(end) && start.slice(8, 16) === from.slice(0, 8) && end.slice(6, 14) === to.slice(0, 8);
      // shortcut: Abweichende Einzeltermine nur beim Umbenennen erhalten; Zeitänderungen brauchen eine Serienbearbeitung.
      const safeExceptions = unchanged && simpleRule && !expectedAttendees.length && event.recurrenceIds.length === event.eventCount - 1 && new Set(event.recurrenceIds).size === event.recurrenceIds.length && event.recurrenceIds.every(line => {
        if (!/^RECURRENCE-ID:\d{8}T\d{6}Z$/.test(line)) return false;
        const value = line.slice(14);
        const date = new Date(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(9, 11)}:${value.slice(11, 13)}:${value.slice(13, 15)}Z`);
        try { return utc(date) === value; } catch { return false; }
      });
      const extraDates = event.fields("RDATE"), exclusions = event.fields("EXDATE");
      if ((event.eventCount !== 1 && (!safeExceptions || extraDates.length > 0)) || event.fields("EXRULE").length || (!unchanged && !safeTimeChange))
        throw new UnsupportedCalendarSeries("Diese Terminserie kann nicht sicher geändert werden.");
      const until = parts.find(part => part.startsWith("UNTIL="))?.slice(6);
      if (!unchanged && (until || exclusions.length || extraDates.length)) {
        const parseUtc = (value: string) => new Date(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(9, 11)}:${value.slice(11, 13)}:${value.slice(13, 15)}Z`);
        try {
          const previous = parseUtc(start.slice(8));
          if (utc(previous) !== start.slice(8)) throw new Error();
          const delta = change.start.getTime() - previous.getTime();
          if (until) {
            const last = parseUtc(until);
            if (utc(last) !== until || last < previous) throw new Error();
            shiftedUntil = utc(new Date(last.getTime() + delta));
          }
          for (const line of [...exclusions, ...extraDates]) {
            const match = /^((?:EXDATE|RDATE)(?:;VALUE=DATE-TIME)?):((?:\d{8}T\d{6}Z)(?:,\d{8}T\d{6}Z)*)$/i.exec(line);
            if (!match) throw new Error();
            const values = match[2]!.split(",").map(value => {
              const date = parseUtc(value);
              if (utc(date) !== value || value.slice(8) !== start.slice(16)) throw new Error();
              const shifted = utc(new Date(date.getTime() + delta));
              if (shifted.slice(0, 8) !== value.slice(0, 8)) throw new Error();
              return shifted;
            });
            shiftedDates.set(line, `${match[1]}:${values.join(",")}`);
          }
        } catch { throw new UnsupportedCalendarSeries("Diese Terminserie kann nicht sicher geändert werden."); }
      }
    }
    const summary = change.title.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,");
    const lines = event.lines.map((line, index) => event.master.indexes.includes(index)
      ? /^SUMMARY(?:;[^:]*)?:/i.test(line) ? line.replace(/^(SUMMARY(?:;[^:]*)?:).*$/i, (_match, prefix: string) => prefix + summary) : /^DTSTART(?:;[^:]*)?:/i.test(line) ? `DTSTART:${from}` : /^DTEND(?:;[^:]*)?:/i.test(line) ? `DTEND:${to}` : shiftedUntil && /^RRULE:/i.test(line) ? line.replace(/(UNTIL=)\d{8}T\d{6}Z/i, (_match, prefix: string) => prefix + shiftedUntil) : shiftedDates.get(line) ?? line
      : line);
    const result = await this.#request(event.url, "PUT", foldCalendar(lines), { "Content-Type": "text/calendar; charset=utf-8", "If-Match": etag });
    if (result.status !== 200 && result.status !== 204) throw new Error("Änderung wurde nicht bestätigt.");
  }

  async deleteEvent(calendarUrl: string, objectUrl: string, etag: string, expectedTitle: string, expectedStart: string, expectedAttendees: string[] = [], expectedSeries = false): Promise<void> {
    const event = await this.#event(calendarUrl, objectUrl, etag, expectedTitle, expectedStart, expectedAttendees, expectedSeries);
    const result = await this.#request(event.url, "DELETE", "", { "If-Match": etag });
    if (result.status !== 200 && result.status !== 204) throw new Error("Löschung wurde nicht bestätigt.");
  }

  async inviteEvent(calendarUrl: string, objectUrl: string, etag: string, expectedTitle: string, expectedStart: string, recipient: string, expectedAttendees: string[] = [], expectedSeries = false): Promise<void> {
    if (!/^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(recipient) || recipient.length > 254 || !/^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(this.#owner)) throw new Error("Ungültige E-Mail-Adresse.");
    const event = await this.#event(calendarUrl, objectUrl, etag, expectedTitle, expectedStart, expectedAttendees, expectedSeries);
    // shortcut: Serien mit Ausnahmen benötigen gesonderte Teilnehmerverwaltung; bei Serienbearbeitung erweitern.
    if (event.series && (event.eventCount !== 1 || event.fields("RRULE").length !== 1 || ["RDATE", "EXDATE", "EXRULE"].some(field => event.fields(field).length))) throw new UnsupportedCalendarSeries("Einladungen zu dieser Terminserie werden noch nicht unterstützt.");
    const organizers = event.fields("ORGANIZER");
    if (event.fields("ATTENDEE").some(line => line.slice(line.indexOf(":") + 1).toLowerCase() === `mailto:${recipient.toLowerCase()}`)) throw new Error("Person ist bereits eingeladen.");
    if (organizers.length > 1 || (organizers.length === 1 && organizers[0]!.slice(organizers[0]!.indexOf(":") + 1).toLowerCase() !== `mailto:${this.#owner.toLowerCase()}`)) throw new Error("Nur eigene Termine können Einladungen erhalten.");
    const insert = [...(organizers.length ? [] : [`ORGANIZER:mailto:${this.#owner}`]), `ATTENDEE;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${recipient}`];
    const lines = [...event.lines.slice(0, event.master.end), ...insert, ...event.lines.slice(event.master.end)];
    const result = await this.#request(event.url, "PUT", foldCalendar(lines), { "Content-Type": "text/calendar; charset=utf-8", "If-Match": etag });
    if (result.status !== 200 && result.status !== 204) throw new Error("Änderung wurde nicht bestätigt.");
  }

}
