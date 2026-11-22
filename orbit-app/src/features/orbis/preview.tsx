// Vorschau neben den Figma-Bildern: npm run dev, dann /src/features/orbis/preview.html?frame=panel-uebersicht&theme=dark öffnen.
// Frames: pille, pille-gruppe, rechtsklick, rechtsklick-gruppe, panel-uebersicht, panel-aktivitaet, panel-bibliothek, computer, computer-schlaeft,
// computer-uebernommen, editor-form, editor-personalisieren, editor-gruppe, editor-gruppe-gefuellt, routinen, routine-neu, routine-neu-b, routine-aendern, aufgabe.
// Ein falscher Dienst ersetzt Tauri (window.__TAURI_INTERNALS__), damit kein Aufruf ins Leere geht.
import { createRoot } from "react-dom/client";
import "../../index.css";
import { useNav } from "../../lib/nav";
import { useOrbit } from "../../lib/store";
import type { Automation, Bot, Group, Routine } from "../../lib/types";
import { useDesktop } from "../routinen/computer";
import { RoutinenView } from "../routinen/RoutinenView";
import { RoutineDialog } from "../routinen/RoutineDialog";
import { TaskView } from "../routinen/TaskView";
import { ComputerView } from "../routinen/ComputerView";
import { EditorDialogs } from "./Editor";
import { OrbiContextMenu, PillMenu } from "./Menus";
import { OrbiPanel } from "./Panel";
import { useOrbisData } from "./data";

const q = new URLSearchParams(location.search);
const frame = q.get("frame") ?? "panel-uebersicht";
const theme = q.get("theme");
if (theme) document.documentElement.setAttribute("data-theme", theme);
document.body.style.margin = "0";
document.body.style.background = "var(--orbit-bg)";
document.body.style.fontFamily = "var(--orbit-font)";

let desk = q.get("desk") ?? (frame === "computer-uebernommen" ? "taken" : frame === "computer-schlaeft" ? "sleeping" : "running");
let daytonaKey = desk !== "unconfigured";
(window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
  transformCallback: () => 1,
  invoke: async (cmd: string, args: { method: string; path: string }) => {
    if (cmd !== "api_request") return null;
    const p = args.path;
    if (p.includes("/desktop-status")) return { ok: true, state: desk, takeoverId: desk === "taken" ? "t-1" : undefined };
    if (p === "/v1/keys") return { ok: true, keys: [{ name: "DAYTONA_API_KEY", set: daytonaKey }] };
    if (args.method === "PUT" && p.startsWith("/v1/daytona/") && p.endsWith("/key")) {
      daytonaKey = true;
      return { ok: true, set: true };
    }
    if (p.endsWith("/sandbox/reconnect") || p.endsWith("/sandbox/setup")) {
      desk = "sleeping";
      return { ok: true, sandboxConfigured: true };
    }
    if (p.includes("/memory")) return { ok: true, entries: q.has("leer") ? [] : MEMORY };
    if (p.includes("/library")) return { ok: true, files: DATEIEN, limitations: [], truncated: false };
    return { ok: true, id: "x", chatId: "c-x", runId: "r1", url: "https://example.invalid", takeoverId: "t-1" };
  },
};

const bot = (id: string, name: string, avatar: string, color: string | null, job: string, extra: Partial<Bot> = {}): Bot => ({
  id, chatId: `c-${id}`, name, avatar, color, job, instructions: "", isMain: false, onboardingDone: true, look: null, lastMessageAt: null, ...extra,
});
const mira = bot("mira", "Mira", "strobi", "#de3a8e", "Termine und Mails", { isMain: true });
const nova = bot("nova", "Nova", "trixi", "#8152eb", "Gliederungen");
const kai = bot("kai", "Kai", "tropi", "#43a561", "Mails prüfen");
const lio = bot("lio", "Lio", "dosi", "#df6521", "Recherche zu Mietpreisen");
const tara = bot("tara", "Tara", "onee", "#199ecd", "Texte überarbeiten");
const alle = [nova, lio, kai, tara];
const m = (b: Bot) => ({ id: b.id, name: b.name, avatar: b.avatar, color: b.color, look: null });
const groups: Group[] = [{ id: "g-wochenteam", name: "Wochenteam", members: [m(mira), m(nova)] }, { id: "g-praes", name: "Präsentation", members: [m(nova)] }];

const MEMORY = Array.from({ length: 38 }, (_, i) => ({
  name: `e${i}`,
  description: i === 0 ? "Mag kurze Antworten" : i === 1 ? "Termine mit 15 min Puffer" : `Eintrag ${i + 1}`,
  updatedAt: new Date(Date.now() - i * 3_600_000).toISOString(),
}));
const DATEIEN = [
  { id: "f1", filename: "Wochenplan.pdf", mediaType: "application/pdf", size: 220_000, chatId: "c-mira", messageId: "m1", createdAt: new Date().toISOString(), kind: "file" },
  { id: "f2", filename: "Mails-Übersicht.md", mediaType: "text/markdown", size: 4_000, chatId: "c-mira", messageId: "m2", createdAt: new Date(Date.now() - 86_400_000).toISOString(), kind: "file" },
  { id: "f3", filename: "Mietpreise.xlsx", mediaType: "application/vnd.ms-excel", size: 80_000, chatId: "c-mira", messageId: "m3", createdAt: new Date(Date.now() - 2 * 86_400_000).toISOString(), kind: "file" },
  { id: "f4", filename: "Foto.png", mediaType: "image/png", size: 1_500_000, chatId: "c-mira", messageId: "m4", createdAt: new Date().toISOString(), kind: "image" },
];

const at = (days: number, h: number, mi = 0) => { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(h, mi, 0, 0); return d.toISOString(); };
const auto = (id: string, name: string, schedule: Automation["schedule"], enabled: boolean, next: string | null, last: string | null): Routine => ({
  bot: { id: "mira", name: "Mira", avatar: "strobi" },
  automation: {
    id, botId: "mira", name, prompt: `Mach ${name}.`, schedule, timezone: "Europe/Berlin", target: "same", chatId: null, notify: "app", model: null, effort: null,
    context: true, enabled, pausedReason: null, lastRunAt: last, resumedAt: null, nextRunAt: next, deletedAt: null, createdAt: at(-30, 9),
  },
});
const routines = [
  auto("a1", "Wochenplan", { kind: "weekly", weekday: 1, at: "08:00" }, true, at(5, 8), at(-2, 8)),
  auto("a2", "Mails zusammenfassen", { kind: "daily", at: "18:00" }, true, at(0, 18), at(-1, 18)),
  auto("a3", "Monatsbericht", { kind: "monthly", day: 1, at: "09:00" }, false, null, null),
];

useOrbit.setState({
  bots: [mira, ...alle], main: mira, groups, selectedChatId: "c-mira", bereit: true, verbindung: "verbunden",
  routines: q.has("leer") ? [] : routines, routineTrash: [],
  cards: [{ id: "k1", kind: "approval", chatId: "c-mira", botId: "mira", toolCallId: "tc1", tool: "calendar_add", input: {}, requestedAt: new Date(Date.now() - 120_000).toISOString(), expiresAt: at(1, 0), runId: "r", text: "Termine eintragen", root: { chatId: "c-mira", taskId: "t1" } }],
  tasks: {
    t1: { taskId: "t1", action: "progress", chatId: "c-mira", botId: "mira", title: "Termine eintragen", brief: "Drei Blöcke in den Kalender eintragen.", progress: null },
    t2: { taskId: "t2", action: "done", chatId: "c-mira", botId: "mira", title: "Kalender gelesen", brief: "", progress: null },
    t3: { taskId: "t3", action: "done", chatId: "c-mira", botId: "mira", title: "Mails zusammengefasst", brief: "", progress: null },
    t4: { taskId: "t4", action: "done", chatId: "c-mira", botId: "mira", title: "Drei Blöcke geplant", brief: "", progress: null },
  },
  steps: [
    ...(frame === "aufgabe"
      ? [["s-a", "Kalender gelesen", 240], ["s-b", "Drei Blöcke geplant", 180], ["s-c", "Recherche an Lio übergeben", 120]].map(([id, label, sek], i) => ({ chatId: "c-mira", botId: "mira", toolCallId: String(id), label: String(label), tool: "calendar", step: i, at: Date.now() - Number(sek) * 1000 }))
      : []),
    { chatId: "c-mira", botId: "mira", toolCallId: "s1", label: "öffnet gerade Safari", tool: "browser", step: 1, at: Date.now() - 30_000 },
  ],
});
useOrbisData.setState({ library: { mira: { files: DATEIEN as never, truncated: false, loaded: true } }, memory: { mira: { entries: q.has("leer") ? [] : MEMORY, loaded: true } } });
useDesktop.setState({ desk: { mira: { state: desk as never } } });

const nav = useNav.getState();
const panelTab = frame === "panel-aktivitaet" ? "aktivitaet" : frame === "panel-bibliothek" ? "bibliothek" : "uebersicht";
if (frame.startsWith("panel")) nav.setPanel(panelTab);
if (frame === "editor-form") nav.openEditor({ kind: "orbi", botId: "mira" });
if (frame === "editor-personalisieren") nav.openEditor({ kind: "orbi", botId: "mira", tab: "personalisieren" });
if (frame === "editor-hauptorbi") nav.openEditor({ kind: "orbi", botId: "nova", tab: "personalisieren" });
if (frame === "editor-gruppe-gefuellt") nav.openEditor({ kind: "gruppe" });
if (frame === "editor-gruppe") nav.openEditor({ kind: "gruppe" });
if (frame === "editor-gruppe-alt") nav.openEditor({ kind: "gruppe", chatId: "g-wochenteam" });

const Stage = ({ children }: { children: React.ReactNode }) => (
  <div style={{ position: "relative", width: 1440, height: 900, overflow: "hidden", background: "var(--orbit-bg)", color: "var(--orbit-text)" }}>{children}</div>
);
const Rechts = ({ children }: { children: React.ReactNode }) => <div style={{ position: "absolute", left: 1100, top: 0, width: 340, height: 900 }}>{children}</div>;

function Szene() {
  switch (frame) {
    case "pille":
    case "pille-gruppe":
      return <PillMenu anchor={{ x: 851, y: 10, width: 75, height: 34 }} onClose={() => undefined} />;
    case "rechtsklick":
    case "rechtsklick-gruppe":
      return <OrbiContextMenu botId="nova" x={150} y={150} onClose={() => undefined} />;
    case "panel-uebersicht":
    case "panel-aktivitaet":
    case "panel-bibliothek":
      return <Rechts><OrbiPanel botId="mira" /></Rechts>;
    case "computer":
    case "computer-schlaeft":
    case "computer-uebernommen":
      return <ComputerView botId="mira" />;
    case "routinen":
      return <Rechts><RoutinenView /></Rechts>;
    case "routine-neu":
    case "routine-neu-b":
      return <RoutineDialog bot={mira} onClose={() => undefined} />;
    case "routine-aendern":
      return <RoutineDialog bot={mira} routine={routines[0]} onClose={() => undefined} />;
    case "aufgabe":
      return <TaskView taskId="t1" />;
    default:
      return <EditorDialogs />;
  }
}

/** Klickt ein Element nach Beschriftung (für Zustände, die Figma zeigt: Hauptorbi bestätigen, Gruppe gefüllt). */
const klick = (sel: string, text?: string) =>
  ([...document.querySelectorAll<HTMLElement>(sel)].find((e) => !text || e.textContent?.trim().endsWith(text)))?.click();
if (frame === "editor-hauptorbi") {
  setTimeout(() => {
    klick('[aria-label="Hauptorbi"]');
    setTimeout(() => klick("button", "Speichern"), 150);
  }, 300);
}
if (frame === "editor-gruppe-gefuellt") {
  setTimeout(() => {
    const feld = document.querySelector<HTMLInputElement>('input[type="text"], input:not([type])');
    if (feld) {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(feld, "Präsentation");
      feld.dispatchEvent(new Event("input", { bubbles: true }));
    }
    klick('[role="checkbox"]', "Mira");
    klick('[role="checkbox"]', "Nova");
  }, 300);
}
// Figma 6.2/6.2b zeigen den Dialog mit gewähltem Vorschlag ("Woche planen" bzw. "Mails zusammenfassen").
if (frame === "routine-neu" || frame === "routine-neu-b") {
  setTimeout(() => klick("button", frame === "routine-neu" ? "Woche planen" : "Mails zusammenfassen"), 300);
}
if (frame === "pille-gruppe" || frame === "rechtsklick-gruppe") {
  // Figma 5.1b/5.2b zeigen das Untermenü offen: Mauskontakt auf "Zu Gruppe hinzufügen" nachstellen.
  setTimeout(() => {
    [...document.querySelectorAll('[role="menuitem"]')].find((e) => e.textContent?.includes("Zu Gruppe"))?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  }, 300);
}

createRoot(document.getElementById("root")!).render(<Stage><Szene /></Stage>);
