// Vorschau des Hauptfensters mit Demo-Daten wie in Figma 03 (kein Dienst, keine Hülle nötig).
// npm run dev, dann /src/features/chat/preview.html?frame=einzel|gruppe|vorstellung|eingeklappt|profilmenue|karten&theme=dark
import { createRoot } from "react-dom/client";
import "../../index.css";
import { useNav } from "../../lib/nav";
import { useOrbit } from "../../lib/store";
import { applyChunk } from "../../lib/chunks";
import type { Bot, Karte, Nachricht, TurnChunk } from "../../lib/types";
import { Blase } from "../../ui";
import { mockDienst } from "../onboarding/mock";
import { AktionsKarte } from "./bausteine";
import { MainWindow } from "./index";

const q = new URLSearchParams(location.search);
const frame = q.get("frame") ?? "einzel";
let daytonaSchluessel = false;
let daytonaComputer = false;
mockDienst({ routen: {
  "GET /v1/daytona/*/desktop-status": () => ({ ok: true, state: q.get("computer") === "laeuft" ? "running" : daytonaComputer ? "sleeping" : "unconfigured" }),
  // Nur Vorschau: ein Stand-in für das noVNC der Sandbox (Pfad ist eine lokale Seite, kein echter Computer).
  "GET /v1/daytona/*/desktop-url": () => ({ ok: true, url: "data:text/html," + encodeURIComponent("<body style='margin:0;font:14px system-ui;background:#1d2733;color:#cfe'><div style='padding:10px'>Vorschau-Stand-in für den echten Bildschirm (noVNC)</div><div style='margin:20px;padding:20px;background:#fff;color:#111;border-radius:8px;width:60%'>Browser im Computer</div></body>") }),
  "GET /v1/keys": () => ({ ok: true, keys: [{ name: "DAYTONA_API_KEY", label: "Daytona", set: daytonaSchluessel, source: null, liveReload: true }] }),
  "PUT /v1/daytona/*/key": () => ({ ok: true, set: daytonaSchluessel = true }),
  "POST /v1/bots/*/sandbox/reconnect": () => ({ ok: true, sandboxConfigured: daytonaComputer = daytonaSchluessel }),
  "POST /v1/bots/*/sandbox/setup": () => ({ ok: true, sandboxConfigured: daytonaComputer = daytonaSchluessel }),
  "GET /v1/search": () => ({ ok: true, results: [] }),
} });
if (q.get("theme")) document.documentElement.setAttribute("data-theme", q.get("theme")!);
try {
  localStorage.setItem("orbit.profil.kurz", "Consti");
  localStorage.setItem("orbit.profil.voll", "Constantin Holzborn");
} catch { /* ohne Speicher */ }

const bot = (id: string, name: string, avatar: string, color: string | null, isMain = false): Bot => ({
  chatId: `c-${id}`, id, name, avatar, color, job: "", instructions: "", isMain, onboardingDone: true, look: null, lastMessageAt: null,
});

const mira = bot("mira", "Mira", "strobi", "#de3a8e", true);
const nova = bot("nova", "Nova", "nova", "#8152eb");
const kai = bot("kai", "Kai", "citrus", "#43a561");
const lio = bot("lio", "Lio", "sunee", "#df6521");
const tara = bot("tara", "Tara", "cloudee", "#199ecd");
const gruppe = { id: "g-team", name: "Wochenteam", members: [{ id: "x", name: "Team", avatar: "cubee", color: "#4f5ae0", look: null }, nova, lio].map((m) => ({ id: m.id, name: m.name, avatar: m.avatar, color: m.color, look: null })) };

const heute = (h: number, m: number) => { const d = new Date(); d.setHours(h, m, 0, 0); return d.getTime(); };
const user = (id: string, text: string, t: number): Nachricht => ({ id, role: "user", parts: [{ type: "text", text }], metadata: { createdAt: t } });
const orbi = (id: string, botId: string, texte: string[], t: number, extra: Nachricht["parts"] = []): Nachricht => ({
  id, role: "assistant", parts: [...texte.map((text) => ({ type: "text" as const, text, state: "done" as const })), ...extra], metadata: { botId, createdAt: t },
});
const zeit = (t: number) => new Date(t).toISOString();

const T = heute(10, 41);
const einzel: Nachricht[] = [
  user("u1", "Kannst du mir helfen, die Woche zu planen?", T),
  orbi("a1", "mira", ["Gern. Ich schlage drei Blöcke vor: Montag Fokus, Mittwoch Abstimmung, Freitag Abschluss.", "Soll ich die Termine direkt in deinen Kalender eintragen?"], T + 1000),
  user("u2", "Ja, bitte.", T + 2000),
  orbi("a2", "mira", [], T + 4000, [{ type: "tool-automation_create", toolCallId: "t1", state: "output-available", input: { name: "Wochenplan jeden Montag", schedule: { kind: "weekly", weekday: 1, at: "08:00" } }, output: { ok: true } }]),
];
const freigabe: Karte = {
  id: "k1", kind: "approval", chatId: "c-mira", botId: "mira", toolCallId: "tc1", tool: "apple_calendar_create_many", input: {},
  requestedAt: zeit(T + 3000), expiresAt: zeit(T + 3_600_000), runId: "r1",
  text: "Mira möchte drei Termine in deinen Kalender eintragen: Montag Fokus, Mittwoch Abstimmung, Freitag Abschluss.",
};
const kaiKarte: Karte = { id: "k-kai", kind: "approval", chatId: "c-kai", botId: "kai", toolCallId: "tk", tool: "mail", input: {}, requestedAt: zeit(T), expiresAt: zeit(T + 3_600_000), runId: "rk", text: "Kai möchte eine Mail senden." };
const T2 = heute(10, 38);
const gruppeMsgs: Nachricht[] = [
  user("g1", "Wir brauchen bis Freitag eine Gliederung für die Präsentation. @Nova übernimmst du?", T2),
  orbi("g2", "nova", ["Mache ich. Ich schlage vier Teile vor: Ausgangslage, Idee, Umsetzung und nächste Schritte."], T2 + 1000),
  orbi("g3", "lio", ["Für „Umsetzung“ habe ich schon Zahlen aus der letzten Woche.", "Soll ich sie dazulegen?"], T2 + 2000),
  user("g4", "Ja, gern.", T2 + 3000),
  orbi("g5", "nova", [], T2 + 4000, [{ type: "tool-apple_calendar_create_many", toolCallId: "tg", state: "output-available", input: { events: [{}, {}, {}] }, output: { ok: true, created: 3 } }]),
];
const T3 = heute(10, 40);
const vorstellung: Nachricht[] = [
  orbi("v1", "mira", ["Hi, ich bin Mira! Ab jetzt kümmere ich mich um deine Termine, Mails und Recherchen.", "Damit ich gut zu dir passe, stelle ich dir drei kurze Fragen. Du kannst jede überspringen."], T3, [
    { type: "tool-ask_user", toolCallId: "q1", state: "input-available", input: { questions: [{ question: "Wie soll ich dir antworten?", options: [{ label: "Kurz und knapp" }, { label: "Ausführlich mit Begründung" }, { label: "Je nach Thema" }] }] } },
  ]),
];
const frage: Karte = {
  id: "k2", kind: "ask", chatId: "c-mira", botId: "mira", toolCallId: "q1", tool: "ask_user", requestedAt: zeit(T3 + 1000), expiresAt: zeit(T3 + 3_600_000), runId: "r2",
  input: (vorstellung[0].parts[2] as any).input,
};
const T4 = heute(8, 12);
const karten: Nachricht[] = [];
void T4;

const set = useOrbit.setState;
const demo = {
  einzel: { msgs: einzel, cards: [freigabe], chat: "c-mira", steps: true },
  gruppe: { msgs: gruppeMsgs, cards: [], chat: "g-team", steps: false },
  vorstellung: { msgs: vorstellung, cards: [frage], chat: "c-mira", steps: false },
  eingeklappt: { msgs: einzel, cards: [freigabe], chat: "c-mira", steps: true },
  profilmenue: { msgs: einzel, cards: [freigabe], chat: "c-mira", steps: true },
  karten: { msgs: karten, cards: [], chat: "c-mira", steps: false },
}[frame] ?? { msgs: einzel, cards: [freigabe], chat: "c-mira", steps: true };

set({
  bereit: true, verbindung: "verbunden",
  bots: [mira, nova, kai, lio, tara], main: mira, groups: [gruppe],
  chats: [
    { id: "c-nova", lastMessageAt: zeit(T), memberCount: 2 }, { id: "c-kai", lastMessageAt: zeit(T - 1000), memberCount: 2 },
    { id: "c-lio", lastMessageAt: zeit(T - 2000), memberCount: 2 }, { id: "c-tara", lastMessageAt: zeit(T - 3000), memberCount: 2 },
    { id: "g-team", lastMessageAt: zeit(T - 4000), memberCount: 4 },
  ],
  selectedChatId: demo.chat,
  messages: {
    [demo.chat]: demo.msgs,
    "c-nova": [orbi("p1", "nova", ["Die Gliederung ist fertig."], T)],
    "c-kai": [orbi("p2", "kai", ["Darf ich die Mail senden?"], T)],
    "c-lio": [orbi("p3", "lio", ["Recherche zu Mietpreisen"], T)],
    "c-tara": [orbi("p4", "tara", ["Neue Fassung verfügbar."], T)],
    "g-team": demo.chat === "g-team" ? demo.msgs : [orbi("p5", "nova", ["Passt das so?"], T)],
  },
  cards: [...demo.cards, kaiKarte],
  unread: { "c-nova": 1 },
  working: frame === "gruppe"
    ? { "g-team:nova": { chatId: "g-team", botId: "nova", status: "arbeitet" } }
    : frame === "karten" ? { "c-mira:mira": { chatId: "c-mira", botId: "mira", status: "wartet" } }
    : frame === "vorstellung" ? {} : { "c-mira:mira": { chatId: "c-mira", botId: "mira", status: "arbeitet" } },
  steps: frame === "gruppe"
    ? [{ chatId: "g-team", botId: "nova", toolCallId: "s1", label: "schreibt die Gliederung", tool: "x", step: 1, at: 0 }]
    : demo.steps ? [{ chatId: "c-mira", botId: "mira", toolCallId: "s2", label: "liest deinen Kalender", tool: "x", step: 1, at: 0 }] : [],
  selectChat: async (id) => set({ selectedChatId: id }),
  loadMessages: async () => {},
  loadOlder: async () => {},
  decide: async (id) => set((s) => ({ cards: s.cards.filter((k) => k.id !== id) })),
  answer: async (id) => set((s) => ({ cards: s.cards.filter((k) => k.id !== id) })),
  stop: async (chatId) => set((s) => ({ streaming: { ...s.streaming, [chatId]: false } })),
  react: async (chatId, messageId, emoji) =>
    set((s) => ({ reactions: { ...s.reactions, [chatId]: [...(s.reactions[chatId] ?? []).filter((r) => !(r.messageId === messageId && r.actor === "user")), ...(emoji ? [{ messageId, actor: "user", emoji }] : [])] } })),
  send: async (chatId, text) => {
    const put = (m: Nachricht) => set((s) => ({ messages: { ...s.messages, [chatId]: [...(s.messages[chatId] ?? []).filter((x) => x.id !== m.id), m] } }));
    put(user(`l-${Date.now()}`, text, Date.now()));
    set((s) => ({ streaming: { ...s.streaming, [chatId]: true } }));
    const antwort = "Das mache ich. **Fett**, *kursiv* und `Code`:\n\n- erster Punkt\n- zweiter Punkt\n\n```\nnpm run dev\n```";
    let cur: Nachricht | null = null;
    const chunks: TurnChunk[] = [{ type: "start", messageId: "s-live", messageMetadata: { botId: chatId === "g-team" ? "nova" : "mira" } }, { type: "text-start", id: "t" }];
    for (let i = 0; i < antwort.length; i += 6) chunks.push({ type: "text-delta", id: "t", delta: antwort.slice(i, i + 6) });
    chunks.push({ type: "text-end", id: "t" }, { type: "finish" });
    for (const c of chunks) {
      await new Promise((r) => setTimeout(r, 60));
      cur = applyChunk(cur, c);
      if (cur) put(cur);
    }
    set((s) => ({ streaming: { ...s.streaming, [chatId]: false } }));
  },
});

if (frame === "laden") {
  const { messages, cards, working, steps } = useOrbit.getState();
  set({ messages: {}, cards: [], working: {}, steps: [], laden: { [demo.chat]: true } });
  setTimeout(() => set({ messages, cards, working, steps, laden: {} }), 5_000);
}

if (frame === "eingeklappt") useNav.setState({ sidebarCollapsed: true });
// ?panel=uebersicht|aktivitaet|bibliothek öffnet die rechte Leiste neben dem Chat
if (q.get("panel")) useNav.setState({ panel: q.get("panel") as "uebersicht" });
// ?klapp=<ms> klappt die linke Leiste nach <ms> um, ?panelwechsel=<ms> schaltet das rechte Panel um (zum Prüfen der Animationen)
if (q.get("klapp")) setTimeout(() => useNav.getState().toggleSidebar(), Number(q.get("klapp")));
if (q.get("panelwechsel")) setTimeout(() => useNav.setState((s) => ({ panel: s.panel ? null : "uebersicht" })), Number(q.get("panelwechsel")));
// ?nav=routinen|einstellungen|plugins|aufgabe|computer zeigt die Gesamtansicht (ohne Dienst bleiben die Daten leer)
const navQ = q.get("nav");
if (navQ === "routinen") useNav.setState({ main: { kind: "routinen" } });
else if (navQ === "einstellungen") useNav.setState({ main: { kind: "einstellungen" } });
else if (navQ === "plugins") useNav.setState({ main: { kind: "einstellungen", page: "plugins" } });
else if (navQ === "aufgabe") useNav.setState({ main: { kind: "aufgabe", taskId: "t1" } });
else if (navQ === "computer") useNav.setState({ main: { kind: "computer", botId: "mira" } });
if (frame === "gruppe") { /* Kopf-Pille und Plugins-Knopf zeigen im Figma-Rahmen den Hover-Zustand */ }

createRoot(document.getElementById("root")!).render(
  <MainWindow
    ampel={q.get("ampel") !== "0"}
    pilleHover={frame === "gruppe"}
    profilOffen={frame === "profilmenue"}
    vorschauExtra={frame === "karten" ? (
      <>
        <div className="flex h-[18px] items-center justify-center text-[13px] leading-[18px] text-o-text-3">Heute, 08:12</div>
        <AktionsKarte symbol="clock" titel="Routine verpasst: Mails zusammenfassen" untertitel="Sonntag 18:00 · dein Mac war aus" aktionen={[{ text: "Überspringen", onClick: () => {} }, { text: "Jetzt ausführen", onClick: () => {} }]} />
        <div><Blase className="max-w-[562px]">Ich bin bei Hirmer, brauche aber einmal deinen Login.</Blase></div>
        <AktionsKarte symbol="lock" titel="Bei Hirmer anmelden" untertitel="Du tippst selbst, Mira sieht dein Passwort nie" aktionen={[{ text: "Übernehmen", onClick: () => {} }]} />
      </>
    ) : undefined}
  />,
);
