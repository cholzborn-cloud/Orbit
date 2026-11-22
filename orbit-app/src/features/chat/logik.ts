// Reine Logik des Chat-Bereichs (ohne React): Chatliste, Punkte, Live-Text, Verlauf in Zeilen, Zeitmarken, Farben.
import type { Bot, Chat, ChoiceWidget, Group, Karte, MemoPart, Nachricht, SecretRequest, ThreadMarker, WorkingEntry, LiveStep } from "../../lib/types";
import type { OrbiFarbe } from "../../ui";

// ---------- Farben ----------

// Hell- und Dunkelwerte aus tokens.css (--orbit-orbi-*).
const HELL: Record<OrbiFarbe, string> = {
  rot: "#d93a3d", orange: "#df6521", gelborange: "#cf811e", limette: "#8fb82f", gruen: "#43a561",
  tuerkis: "#43a191", himmel: "#199ecd", blau: "#3378ec", indigo: "#4f5ae0", violett: "#8152eb",
  fuchsia: "#b53acb", pink: "#de3a8e", braun: "#8a6038", grau: "#6b7483", weiss: "#e8e8ea",
};
const DUNKEL: Record<OrbiFarbe, string> = {
  rot: "#e84447", orange: "#e87031", gelborange: "#e9993a", limette: "#a5d046", gruen: "#5ac078",
  tuerkis: "#55b5a4", himmel: "#32b3e6", blau: "#3e82f4", indigo: "#626df5", violett: "#895df3",
  fuchsia: "#c849e4", pink: "#e74897", braun: "#996e42", grau: "#7d8797", weiss: "#ffffff",
};

function rgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** Nächstliegende Orbi-Farbe zu einem Hexwert (Blasen und Senden-Knopf folgen der Farbe des Orbis). */
export function farbeVonHex(hex: string | null | undefined, standard: OrbiFarbe = "pink"): OrbiFarbe {
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return standard;
  const [r, g, b] = rgb(hex);
  let best = standard;
  let bestD = Infinity;
  for (const tabelle of [HELL, DUNKEL]) {
    for (const [name, wert] of Object.entries(tabelle) as [OrbiFarbe, string][]) {
      const [r2, g2, b2] = rgb(wert);
      const d = (r - r2) ** 2 + (g - g2) ** 2 + (b - b2) ** 2;
      if (d < bestD) {
        bestD = d;
        best = name;
      }
    }
  }
  return best;
}

// ---------- Chatliste ----------

export interface ListenEintrag {
  art: "orbi" | "gruppe";
  chatId: string;
  name: string;
  /** Orbi: das Bot-Objekt; Gruppe: erstes Mitglied als Stellvertreter für die Figur. */
  avatar: string;
  color: string | null;
  look: Bot["look"];
  letzte: string | null;
  bot?: Bot;
  gruppe?: Group;
}

const zeit = (s: string | null | undefined) => (s ? Date.parse(s) || 0 : 0);

/** Hauptorbi als Kachel, alle übrigen Orbis und Gruppen nach letzter Nachricht (neueste zuerst). */
export function chatListe(bots: Bot[], groups: Group[], chats: Chat[], main: Bot | null) {
  const letzte = new Map<string, string | null>();
  for (const c of chats) letzte.set(c.id, c.lastMessageAt);
  const haupt = main ?? bots.find((b) => b.isMain) ?? null;
  const eintraege: ListenEintrag[] = [];
  for (const b of bots) {
    if (haupt && b.id === haupt.id) continue;
    eintraege.push({
      art: "orbi", chatId: b.chatId, name: b.name, avatar: b.avatar, color: b.color, look: b.look,
      letzte: letzte.get(b.chatId) ?? b.lastMessageAt, bot: b,
    });
  }
  for (const g of groups) {
    const m = g.members[0];
    eintraege.push({
      art: "gruppe", chatId: g.id, name: g.name, avatar: m?.avatar ?? "universi", color: m?.color ?? null,
      look: m?.look ?? null, letzte: letzte.get(g.id) ?? null, gruppe: g,
    });
  }
  const sortiert = eintraege
    .map((e, i) => ({ e, i }))
    .sort((a, b) => zeit(b.e.letzte) - zeit(a.e.letzte) || a.i - b.i)
    .map((x) => x.e);
  return { haupt, eintraege: sortiert };
}

export type Punkt = "fertig" | "braucht-dich" | null;

/** Orange: Karte wartet oder Orbi wartet auf dich. Blau: ungelesene Nachricht. */
export function chatPunkt(
  chatId: string,
  unread: Record<string, number>,
  cards: Karte[],
  working: Record<string, WorkingEntry>,
): Punkt {
  if (cards.some((k) => k.chatId === chatId)) return "braucht-dich";
  if (Object.values(working).some((w) => w.chatId === chatId && w.status === "wartet")) return "braucht-dich";
  if ((unread[chatId] ?? 0) > 0) return "fertig";
  return null;
}

/** Orbis, die in diesem Chat gerade arbeiten oder warten. */
export function arbeiter(chatId: string, working: Record<string, WorkingEntry>): WorkingEntry[] {
  return Object.values(working).filter((w) => w.chatId === chatId && (w.status === "arbeitet" || w.status === "wartet"));
}

export function letzterSchritt(chatId: string, botId: string, steps: LiveStep[]): LiveStep | null {
  let best: LiveStep | null = null;
  for (const s of steps) {
    if (s.chatId !== chatId || s.botId !== botId) continue;
    if (!best || s.step >= best.step) best = s;
  }
  return best;
}

/** "Mira arbeitet · liest deinen Kalender" / "Mira wartet auf deine Antwort". */
export function liveText(name: string, status: WorkingEntry["status"], label?: string | null): string {
  if (status === "wartet") return label ? `${name} is waiting for ${label}` : `${name} is waiting for you`;
  return label ? `${name} is working · ${label}` : `${name} is working`;
}

// ---------- Nachrichten ----------

export function textVon(m: Nachricht): string {
  const teile: string[] = [];
  for (const p of m.parts) {
    if (p.type === "text") teile.push(p.text);
    else if (p.type === "tool-say" && typeof (p as any).input?.text === "string") teile.push((p as any).input.text);
    else if (typeof p.type === "string" && istSendToUser(p.type.slice(5)) && p.type.startsWith("tool-")) {
      const t = sendText((p as any).input);
      if (t) teile.push(t);
    }
  }
  return teile.join("\n\n").trim();
}

/** Vorschau in der Chatliste: letzte Nachricht, in Gruppen mit Absender. */
export function vorschau(m: Nachricht | undefined, absender?: string | null): string {
  if (!m) return "";
  let t = textVon(m).replace(/[*_`#>]/g, "").replace(/\s+/g, " ").trim();
  if (!t && m.parts.some((p) => p.type === "file" || p.type === "image")) t = "File";
  if (!t && m.parts.some((p) => p.type === "memo")) t = "Voice memo";
  if (!t) return "";
  return absender ? `${absender}: ${t}` : t;
}

/** Zeitpunkt einer Nachricht in ms, falls bekannt. */
export function nachrichtZeit(m: Nachricht): number | null {
  const md = m.metadata ?? {};
  const roh = (md as any).createdAt ?? md.startedAt ?? md.finishedAt;
  if (typeof roh === "number") return roh;
  if (typeof roh === "string") {
    const t = Date.parse(roh);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

const MONATE = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const zweistellig = (n: number) => String(n).padStart(2, "0");

/** "Today, 10:41", "Yesterday, 09:05", otherwise "Nov 12, 10:41". */
export function zeitLabel(ts: number, jetzt: number = Date.now()): string {
  const d = new Date(ts);
  const n = new Date(jetzt);
  const uhr = `${zweistellig(d.getHours())}:${zweistellig(d.getMinutes())}`;
  const tag = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((tag(n) - tag(d)) / 86_400_000);
  if (diff === 0) return `Today, ${uhr}`;
  if (diff === 1) return `Yesterday, ${uhr}`;
  const jahr = d.getFullYear() === n.getFullYear() ? "" : ` ${d.getFullYear()}`;
  return `${MONATE[d.getMonth()]} ${d.getDate()}${jahr}, ${uhr}`;
}

export type Blasenteil =
  | { art: "text"; text: string; streaming: boolean }
  | { art: "say"; text: string }
  | { art: "send"; text: string };

/** Names of the upcoming delivery tool (`tool-SendToUser`; snake case tolerated). */
export const istSendToUser = (name: string) => name === "SendToUser" || name === "send_to_user";

/** Text or Markdown of a SendToUser input. */
export function sendText(input: any): string {
  const t = typeof input?.markdown === "string" ? input.markdown : typeof input?.text === "string" ? input.text : "";
  return t.trim() ? t : "";
}

/** Secure-input request, normalised: needs name + label. */
export function secretVon(s: any): SecretRequest | null {
  if (!s || typeof s !== "object") return null;
  const name = typeof s.name === "string" ? s.name.trim() : "";
  const label = typeof s.label === "string" ? s.label.trim() : "";
  if (!name || !label) return null;
  const out: SecretRequest = { name, label };
  if (typeof s.description === "string" && s.description.trim()) out.description = s.description.trim();
  if (typeof s.plugin_id === "string" && s.plugin_id.trim()) out.pluginId = s.plugin_id.trim();
  else if (typeof s.pluginId === "string" && s.pluginId.trim()) out.pluginId = s.pluginId.trim();
  if (s.answer && typeof s.answer === "object") {
    out.answer = { stored: !!s.answer.stored, movedOn: !!s.answer.movedOn };
  }
  return out;
}

/** Choice widget, normalised: 1–6 options with a label; anything else is not shown. */
export function widgetVon(w: any): ChoiceWidget | null {
  if (!w || typeof w !== "object" || !Array.isArray(w.options)) return null;
  const options = w.options
    .map((o: any) => (typeof o === "string" ? { label: o } : o && typeof o.label === "string" ? {
      id: typeof o.id === "string" ? o.id : undefined, label: o.label,
      value: typeof o.value === "string" && o.value.trim() ? o.value : undefined,
      description: typeof o.description === "string" ? o.description : undefined,
      style: o.style === "primary" || o.style === "danger" ? o.style : "default",
    } : null))
    .filter((o: any) => o && o.label.trim())
    .slice(0, 6);
  if (options.length === 0) return null;
  const answer = w.answer && Array.isArray(w.answer.selected)
    ? { selected: w.answer.selected.map(String), custom: typeof w.answer.custom === "string" ? w.answer.custom : undefined } : undefined;
  return {
    id: typeof w.id === "string" ? w.id : undefined, prompt: typeof w.prompt === "string" ? w.prompt : undefined, options,
    helpText: typeof w.helpText === "string" ? w.helpText : undefined,
    multiple: !!(w.multiple ?? w.multiSelect), allowCustom: !!w.allowCustom, customPlaceholder: typeof w.customPlaceholder === "string" ? w.customPlaceholder : undefined, answer,
  };
}

function memoVon(m: any): Omit<MemoPart, "type"> | null {
  if (!m || typeof m.url !== "string" || !m.url) return null;
  return {
    url: m.url, mediaType: typeof m.mediaType === "string" ? m.mediaType : undefined,
    durationMs: typeof m.durationMs === "number" && Number.isFinite(m.durationMs) ? m.durationMs : undefined,
    title: typeof m.title === "string" ? m.title : undefined, transcript: typeof m.transcript === "string" ? m.transcript : undefined,
  };
}

function threadVon(t: any): ThreadMarker | undefined {
  return t && typeof t.messageId === "string" ? { messageId: t.messageId, name: typeof t.name === "string" ? t.name : undefined, text: typeof t.text === "string" ? t.text : undefined } : undefined;
}

export type Eintrag = EintragOhneZeit & { ts: number | null };

type EintragOhneZeit =
  | { t: "zeit"; key: string; label: string }
  | { t: "ich"; key: string; messageId: string; text: string; dateien: Datei[]; failed: boolean }
  | { t: "orbi"; key: string; messageId: string; reaktionId: string; botId: string | null; blase: Blasenteil; absender: boolean; aborted: boolean; fehler?: string }
  | { t: "frage"; key: string; messageId: string; toolCallId: string; input: any; output: any; offen: boolean }
  | { t: "system"; key: string; text: string; detail?: string; symbol: string }
  | { t: "ergebnis"; key: string; titel: string; untertitel: string; symbol: "kalender" }
  | { t: "datei"; key: string; messageId: string; reaktionId: string; botId: string | null; datei: Datei }
  | { t: "auswahl"; key: string; messageId: string; toolCallId: string; botId: string | null; widget: ChoiceWidget }
  | { t: "geheim"; key: string; messageId: string; toolCallId: string; botId: string | null; secret: SecretRequest }
  | { t: "memo"; key: string; messageId: string; reaktionId: string; botId: string | null; memo: Omit<MemoPart, "type"> }
  | { t: "faden"; key: string; messageId: string; botId: string | null; faden: ThreadMarker };

export interface Datei {
  url: string;
  mediaType: string;
  filename?: string;
  /** Alt text of an image (SendToUser images). */
  alt?: string;
}

const KARTEN_PAUSE_MS = 30 * 60_000;

/** Schlüsselworte für Werkzeug-Karten, die als Systemzeile erscheinen. */
function systemZeile(toolName: string, input: any, output: any): { text: string; detail?: string; symbol: string } | null {
  if (toolName === "automation_create") {
    const d = input?.name || planText(input?.schedule);
    return { text: "Created: routine", detail: d || undefined, symbol: "clock" };
  }
  if (toolName === "create_orbi") {
    return { text: "Created: Orbi", detail: input?.name || output?.name || undefined, symbol: "bot" };
  }
  return null;
}

const ZAHLWORT = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve"];

/** Ergebnis-Karte "Drei Termine eingetragen · Apple Kalender · Erledigt" (Figma 03 Gruppe) für fertig angelegte Termine. */
function ergebnisKarte(toolName: string, input: any, output: any): { titel: string; untertitel: string; symbol: "kalender" } | null {
  if (toolName !== "apple_calendar_create" && toolName !== "apple_calendar_create_many") return null;
  if (output?.ok === false) return null;
  const n = toolName === "apple_calendar_create" ? 1 : Number(output?.created ?? (Array.isArray(input?.events) ? input.events.length : 0));
  const titel = n === 1 ? "One event added" : n > 1 ? `${n < ZAHLWORT.length ? ZAHLWORT[n] : n} events added` : "Events added";
  return { titel, untertitel: "Apple Calendar", symbol: "kalender" };
}

const WOCHENTAGE = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Kurztext zum Zeitplan einer Routine ("jeden Montag, 08:00"). */
export function planText(s: any): string {
  if (!s || typeof s !== "object") return "";
  const at = typeof s.at === "string" ? s.at : "";
  switch (s.kind) {
    case "daily": return `daily ${at}`.trim();
    case "weekdays": return `weekdays ${at}`.trim();
    case "weekly": return `every ${WOCHENTAGE[s.weekday ?? 1] ?? ""} ${at}`.trim();
    case "monthly": return `monthly on day ${s.day ?? 1} ${at}`.trim();
    case "once": return `once ${s.date ?? ""} ${at}`.trim();
    default: return "";
  }
}

/**
 * Macht aus Nachrichten die Zeilen des Verlaufs. Jede sichtbare Blase bekommt eine eigene stabile ID;
 * Karten (Werkzeugteile) und Systemzeilen stehen eigen. Fragen zeigt der Verlauf nur, wenn sie noch offen oder beantwortet sind.
 */
export function baueVerlauf(
  nachrichten: Nachricht[],
  opts: { gruppe: boolean; offeneKarten?: Karte[]; jetzt?: number } = { gruppe: false },
): Eintrag[] {
  const out: Eintrag[] = [];
  const offen = new Set((opts.offeneKarten ?? []).map((k) => k.toolCallId));
  let letzteZeit: number | null = null;
  let letzterOrbi: string | null | undefined;
  let msgTs: number | null = null;
  const anderes = (e: EintragOhneZeit) => {
    out.push({ ...e, ts: msgTs });
    letzterOrbi = undefined;
  };

  for (const m of nachrichten) {
    const ts = nachrichtZeit(m);
    msgTs = ts ?? letzteZeit;
    if (ts != null && (letzteZeit == null || ts - letzteZeit >= KARTEN_PAUSE_MS)) {
      anderes({ t: "zeit", key: `z-${m.id}`, label: zeitLabel(ts, opts.jetzt) });
    }
    if (ts != null) letzteZeit = ts;

    if (m.role === "system") continue;

    if (m.role === "user") {
      const text = m.parts.filter((p) => p.type === "text").map((p: any) => p.text).join("\n\n").trim();
      const dateien = m.parts.filter((p) => p.type === "file").map((p: any) => ({ url: p.url, mediaType: p.mediaType, filename: p.filename }));
      if (!text && dateien.length === 0) continue;
      anderes({
        t: "ich", key: `m-${m.id}`, messageId: m.id, text, dateien,
        failed: !!m.metadata?.failed,
      });
      continue;
    }

    // Antwort eines Orbis
    const botId: string | null = m.metadata?.botId ?? null;
    let textNr = 0;
    const blase = (id: string, b: Blasenteil) => {
      out.push({ t: "orbi", key: id, messageId: m.id, reaktionId: id, botId, blase: b,
        absender: opts.gruppe && letzterOrbi !== botId, aborted: false, ts: msgTs });
      letzterOrbi = botId;
    };
    const datei = (id: string, d: Datei) => {
      anderes({ t: "datei", key: id, messageId: m.id, reaktionId: id, botId, datei: d });
    };

    const faden = threadVon(m.metadata?.thread);
    if (faden) anderes({ t: "faden", key: `r-${m.id}`, messageId: m.id, botId, faden });
    let sendFaden = !!faden;
    const bild = (id: string, b: any) => {
      if (!b || typeof b.url !== "string" || !b.url) return;
      const alt = typeof b.alt === "string" && b.alt.trim() ? b.alt : undefined;
      datei(id, { url: b.url, mediaType: typeof b.mediaType === "string" ? b.mediaType : "image/*", filename: alt, alt });
    };

    for (const [index, p] of m.parts.entries()) {
      if (!p || typeof p.type !== "string") continue;
      if (p.type === "text") {
        const id = p.id ?? `${m.id}~t${textNr}`;
        textNr++;
        if (p.text.trim()) blase(id, { art: "text", text: p.text, streaming: p.state === "streaming" });
      } else if (p.type === "file") {
        datei(`${m.id}~f${index}`, { url: p.url, mediaType: p.mediaType, filename: p.filename });
      } else if (p.type === "image") {
        bild(`${m.id}~i${index}`, p);
      } else if (p.type === "memo") {
        const memo = memoVon(p);
        if (memo) anderes({ t: "memo", key: `${m.id}~a${index}`, messageId: m.id, reaktionId: `${m.id}~a${index}`, botId, memo });
      } else if (p.type.startsWith("tool-")) {
        const name = p.type.slice(5);
        const tp = p as any;
        if (istSendToUser(name)) {
          const inp = tp.input ?? {};
          const id = tp.toolCallId ?? String(index);
          const marke = threadVon(inp.replyTo);
          if (marke && !sendFaden) {
            anderes({ t: "faden", key: `r-${m.id}-${id}`, messageId: m.id, botId, faden: marke });
            sendFaden = true;
          }
          const t = sendText(inp);
          if (t) blase(`${m.id}~u${id}`, { art: "send", text: t });
          if (Array.isArray(inp.images)) inp.images.forEach((b: any, i: number) => bild(`${m.id}~u${id}~i${i}`, b));
          const memo = memoVon(inp.memo);
          if (memo) anderes({ t: "memo", key: `${m.id}~u${id}~a`, messageId: m.id, reaktionId: `${m.id}~u${id}~a`, botId, memo });
          const w = widgetVon(inp.widget);
          if (w) {
            const ausgabe = tp.output?.answer ?? tp.output;
            const answer = w.answer
              ?? (ausgabe && Array.isArray(ausgabe.selected)
                ? { selected: ausgabe.selected.map(String), custom: typeof ausgabe.custom === "string" ? ausgabe.custom : undefined }
                : ausgabe?.movedOn ? { selected: [], custom: undefined } : undefined);
            anderes({ t: "auswahl", key: `w-${m.id}-${id}`, messageId: m.id, toolCallId: id, botId, widget: { ...w, answer } });
          }
          const sec = secretVon(inp.secret);
          if (sec) {
            const ausgabe = tp.output?.answer ?? tp.output;
            const answer = sec.answer
              ?? (ausgabe?.stored ? { stored: true } : ausgabe?.movedOn ? { stored: false, movedOn: true } : undefined);
            anderes({ t: "geheim", key: `sec-${m.id}-${id}`, messageId: m.id, toolCallId: id, botId, secret: { ...sec, answer } });
          }
        } else if (name === "say") {
          if (typeof tp.input?.text === "string" && tp.input.text.trim()) blase(`${m.id}~s${tp.toolCallId}`, { art: "say", text: tp.input.text });
        } else if (name === "ask_user" || name === "InstallPlugin") {
          anderes({
            t: "frage", key: `q-${m.id}-${tp.toolCallId}`, messageId: m.id, toolCallId: tp.toolCallId,
            input: tp.input, output: tp.output, offen: offen.has(tp.toolCallId),
          });
        } else if (["share_file", "generate_image", "create_pdf", "create_word"].includes(name)) {
          const o = tp.output;
          if (o && typeof o.data === "string") {
            const url = o.data.startsWith("data:") ? o.data : `data:${o.mediaType ?? "application/octet-stream"};base64,${o.data}`;
            datei(`${m.id}~f${tp.toolCallId}`, { url, mediaType: o.mediaType ?? "application/octet-stream", filename: o.filename });
          }
        } else {
          const z = tp.state === "output-available" ? systemZeile(name, tp.input, tp.output) : null;
          if (z) anderes({ t: "system", key: `s-${m.id}-${tp.toolCallId}`, ...z });
          const k = tp.state === "output-available" ? ergebnisKarte(name, tp.input, tp.output) : null;
          if (k) anderes({ t: "ergebnis", key: `e-${m.id}-${tp.toolCallId}`, ...k });
        }
      }
    }
    if (m.metadata?.aborted || m.metadata?.error) {
      const l = out[out.length - 1];
      if (l && l.t === "orbi" && l.messageId === m.id) {
        l.aborted = !!m.metadata?.aborted;
        l.fehler = m.metadata?.error;
      }
    }
  }
  return out;
}

/** Fragen aus der Eingabe einer Rückfrage (`input.questions`), robust gegen fehlende Felder. */
export interface Frage {
  question: string;
  options: { label: string; description?: string; recommended?: boolean }[];
}

export function fragenVon(input: any, fallbackText?: string): Frage[] {
  const qs = input?.questions;
  if (Array.isArray(qs) && qs.length) {
    return qs.map((q: any) => ({
      question: String(q?.question ?? ""),
      options: Array.isArray(q?.options)
        ? q.options.map((o: any) => (typeof o === "string" ? { label: o } : { label: String(o?.label ?? ""), description: o?.description, recommended: !!o?.recommended }))
        : [],
    }));
  }
  if (typeof input?.question === "string") return [{ question: input.question, options: [] }];
  return fallbackText ? [{ question: fallbackText, options: [] }] : [];
}

/** Text einer Freigabe-Karte. */
export function freigabeText(k: Karte, name: string): string {
  const t = k.text ?? k.detail;
  if (t && t.trim()) return t;
  return `${name} wants to run “${k.tool}”.`;
}

export { initialen } from "../../lib/profil";

// ---------- Eingabe ----------

/** Enter sendet, Shift+Enter bricht um, während der Texteingabe-Komposition (Akzente, Eingabemethoden) nie senden. */
export function sendeTaste(e: { key: string; shiftKey: boolean; altKey?: boolean; metaKey?: boolean; ctrlKey?: boolean; isComposing?: boolean; keyCode?: number }): boolean {
  if (e.key !== "Enter") return false;
  if (e.isComposing || e.keyCode === 229) return false;
  if (e.shiftKey || e.altKey) return false;
  return true;
}

/** Kurzbefehle des Hauptfensters: ⌘, Einstellungen, ⌘N neuer Chat, ⌘\ Seitenleiste. */
export function kurzbefehl(e: { key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }): "einstellungen" | "neu" | "seitenleiste" | null {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return null;
  if (e.key === "," && !e.shiftKey) return "einstellungen";
  if ((e.key === "n" || e.key === "N") && !e.shiftKey) return "neu";
  // ⌘\ wie in anderen Apps; ⌘B zusätzlich, weil das Backslash auf der deutschen Tastatur nur mit Umschalttasten geht.
  if ((e.key === "\\" || e.key === "b" || e.key === "B") && !e.shiftKey) return "seitenleiste";
  return null;
}

export type VerlaufsZeile = Eintrag | { t: "karte"; key: string; karte: Karte; ts: number };

/** Karten (Freigaben, nicht eingebettete Fragen) zeitlich in den Verlauf einordnen: vor die erste Zeile, die später kam. Ohne Zeit ans Ende. */
export function mischeKarten(eintraege: Eintrag[], karten: Karte[]): VerlaufsZeile[] {
  const out: VerlaufsZeile[] = [...eintraege];
  const sortiert = [...karten].sort((a, b) => Date.parse(a.requestedAt) - Date.parse(b.requestedAt));
  for (const k of sortiert) {
    const t = Date.parse(k.requestedAt);
    const z: VerlaufsZeile = { t: "karte", key: `k-${k.id}`, karte: k, ts: t };
    const i = Number.isNaN(t) ? -1 : out.findIndex((e) => e.ts != null && e.ts > t && e.t !== "zeit");
    if (i < 0) out.push(z);
    else out.splice(i, 0, z);
  }
  return out;
}
