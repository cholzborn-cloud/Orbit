import { create } from "zustand";

// Navigation im Hauptfenster. Der Chat-Bereich (features/chat) besitzt den Rahmen und zeigt je nach `main` die Ansicht.
export type MainView =
  | { kind: "chat" }
  | { kind: "einstellungen"; page?: string; pluginId?: string }
  | { kind: "routinen" }
  | { kind: "aufgabe"; taskId: string }
  | { kind: "computer"; botId: string };

export type PanelTab = "uebersicht" | "aktivitaet" | "bibliothek";

/** Breiten der Seitenleisten (px): Standard aus Figma 03, Grenzen fürs Ziehen. Eingeklappt ist fest 88. */
export const LEISTE = {
  links: { std: 336, min: 260, max: 440 },
  rechts: { std: 340, min: 300, max: 480 },
  klein: 88,
} as const;

const SPEICHER = "orbit.leisten.v1";
const klemme = (v: unknown, g: { std: number; min: number; max: number }) =>
  typeof v === "number" && Number.isFinite(v) ? Math.round(Math.min(g.max, Math.max(g.min, v))) : g.std;

/** Gemerkte Breiten und Eingeklappt-Zustand (localStorage; ohne Speicher gelten die Standardwerte). */
function geladen() {
  try {
    const j = JSON.parse(localStorage.getItem(SPEICHER) ?? "{}");
    return { sidebarWidth: klemme(j.links, LEISTE.links), panelWidth: klemme(j.rechts, LEISTE.rechts), sidebarCollapsed: j.klein === true };
  } catch {
    return { sidebarWidth: LEISTE.links.std, panelWidth: LEISTE.rechts.std, sidebarCollapsed: false };
  }
}

interface NavState {
  main: MainView;
  panel: PanelTab | null; // rechtes 340-Panel
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  panelWidth: number;
  /** Editor-Dialoge: Orbi (bearbeiten/neu) oder Gruppe */
  editor: null | { kind: "orbi"; botId?: string; tab?: "form" | "personalisieren" } | { kind: "gruppe"; chatId?: string };
  go: (v: MainView) => void;
  setPanel: (p: PanelTab | null) => void;
  toggleSidebar: () => void;
  setSidebarWidth: (w: number) => void;
  setPanelWidth: (w: number) => void;
  openEditor: (e: NavState["editor"]) => void;
}

export const useNav = create<NavState>((set) => ({
  main: { kind: "chat" },
  panel: null,
  ...geladen(),
  editor: null,
  go: (main) => set({ main }),
  setPanel: (panel) => set({ panel }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setSidebarWidth: (w) => set({ sidebarWidth: klemme(w, LEISTE.links) }),
  setPanelWidth: (w) => set({ panelWidth: klemme(w, LEISTE.rechts) }),
  openEditor: (editor) => set({ editor }),
}));

// Änderungen sofort merken.
useNav.subscribe((s, alt) => {
  if (s.sidebarWidth === alt.sidebarWidth && s.panelWidth === alt.panelWidth && s.sidebarCollapsed === alt.sidebarCollapsed) return;
  try {
    localStorage.setItem(SPEICHER, JSON.stringify({ links: s.sidebarWidth, rechts: s.panelWidth, klein: s.sidebarCollapsed }));
  } catch { /* ohne Speicher */ }
});

/** Größte Breite einer Leiste, damit dem Chat mindestens 480 px bleiben (nie unter dem Mindestwert). */
export function maxBreite(seite: "links" | "rechts", andere: number): number {
  const g = LEISTE[seite];
  const frei = (typeof window === "undefined" ? 1440 : window.innerWidth) - andere - 480;
  return Math.max(g.min, Math.min(g.max, frei));
}

/** CSS-Breite einer Leiste: gemerkter Wert `w`, aber in engen Fenstern schmaler (nie unter dem Mindestwert), damit dem Chat etwa 480 px bleiben. */
export function cssBreite(seite: "links" | "rechts", w: number, andere: number): string {
  const g = LEISTE[seite];
  return `clamp(${g.min}px, min(${w}px, 100vw - ${andere}px - 480px), ${Math.max(w, g.min)}px)`;
}
