import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const antworten: Record<string, unknown> = {
  "/messages": { ok: true, messages: [], hasMore: false, interrupted: null, reactions: [] },
  "/v1/automations": { ok: true, automations: [], trash: [] },
  "/v1/usage": { ok: true, providers: [], fetchedAt: "2026-01-01T00:00:00Z" },
  "/v1/rules": { ok: true, rules: [] },
  "/v1/models": { ok: true, models: [] },
  "/v1/clis": { ok: true, clis: [] },
  "/v1/mcp/servers": { ok: true, servers: [] },
  "/v1/settings": { ok: true, settings: { theme: "system", jevAuto: false, jevHandoff: false, baseInstructions: null } },
};
vi.mock("./lib/tauri", () => ({
  openUrl: async () => {},
  accountStatus: async () => ({ signedIn: true, configured: true, email: "test@orbit.local", displayName: "Test", photoUrl: null }),
  accountSignOut: async () => {},
  serviceConnect: async () => ({ port: 1, dataDir: "x" }),
  apiRequest: async (_m: string, path: string) => {
    const p = path.split("?")[0];
    const k = Object.keys(antworten).find((x) => p.endsWith(x));
    return k ? antworten[k] : { ok: true };
  },
  apiStream: () => ({ done: new Promise<void>(() => {}), cancel: async () => {} }),
}));

import App from "./App";
import { designAnwenden } from "./features/einstellungen";
import { useAuth } from "./lib/auth";
import { LEISTE, useNav, type MainView } from "./lib/nav";
import { useOrbit } from "./lib/store";

const bot = { chatId: "c1", id: "b1", name: "Mira", avatar: "strobi", color: null, job: "Hilft", instructions: "", isMain: true, onboardingDone: true, look: null, lastMessageAt: null };
const ansichten: MainView[] = [
  { kind: "chat" }, { kind: "routinen" }, { kind: "aufgabe", taskId: "t1" }, { kind: "computer", botId: "b1" },
  ...["allgemein", "darstellung", "personalisierung", "plugins", "nutzung", "arbeitsumgebung", "sicherheit"].map((page) => ({ kind: "einstellungen" as const, page })),
];

let fehler: unknown[] = [];
beforeEach(() => {
  fehler = [];
  vi.spyOn(console, "error").mockImplementation((...a) => { fehler.push(a); });
  useAuth.setState({ signedIn: true, configured: true, info: { signedIn: true, configured: true, email: "test@orbit.local", displayName: "Test", photoUrl: null } });
  useOrbit.setState({ bereit: true, bots: [bot], main: bot, selectedChatId: "c1", groups: [] } as never);
  useNav.setState({ main: { kind: "chat" }, panel: null, editor: null, sidebarCollapsed: false, sidebarWidth: LEISTE.links.std, panelWidth: LEISTE.rechts.std });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); designAnwenden("system"); useAuth.setState({ signedIn: null, configured: true, info: null }); });

describe("App", () => {
  for (const theme of ["light", "dark"] as const) {
    it(`rendert alle Ansichten im Theme ${theme}`, async () => {
      designAnwenden(theme);
      antworten["/v1/settings"] = { ok: true, settings: { theme, jevAuto: false, jevHandoff: false, baseInstructions: null } };
      const { container } = render(<App />);
      for (const v of ansichten) {
        await act(async () => { useNav.getState().go(v); });
        await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
        expect(container.querySelector("[data-hauptfenster]")).toBeTruthy();
      }
      expect(document.documentElement.dataset.theme).toBe(theme);
      expect(fehler.filter((f: any) => /Error|Warning/.test(String(f[0])))).toEqual([]);
    });
  }

  it("zeigt beim Erststart sofort ein Ladebild und hält es bis zur Antwort des Profils", async () => {
    let profilBereit!: (wert: unknown) => void;
    antworten["/v1/setup/profile"] = new Promise((resolve) => { profilBereit = resolve; });
    useOrbit.setState({ bereit: false, verbindungsfehler: null, main: null, bots: [], selectedChatId: null });
    try {
      const { getByRole, findByRole, queryByRole } = render(<App />);
      expect(getByRole("status", { name: "Orbit is loading" }).querySelector("svg")).toBeTruthy();
      await act(async () => { useOrbit.setState({ bereit: true }); });
      expect(getByRole("status", { name: "Orbit is loading" })).toBeTruthy();
      expect(queryByRole("heading", { name: "Welcome to Orbit" })).toBeNull();

      profilBereit({ ok: true, required: true, draft: {} });
      await findByRole("heading", { name: "Welcome to Orbit" }, { timeout: 2000 });
      expect(queryByRole("status", { name: "Orbit is loading" })).toBeNull();
    } finally {
      delete antworten["/v1/setup/profile"];
    }
  });

  it("behält den Chat beim Wechsel in die Einstellungen eingehängt", async () => {
    const { container } = render(<App />);
    await waitFor(() => expect(container.querySelector("textarea, [contenteditable]")).toBeTruthy());
    const feld = container.querySelector("textarea, [contenteditable]");
    await act(async () => { useNav.getState().go({ kind: "einstellungen" }); });
    expect(container.querySelector("textarea, [contenteditable]")).toBe(feld);
    await act(async () => { useNav.getState().go({ kind: "chat" }); });
    expect(container.querySelector("textarea, [contenteditable]")).toBe(feld);
  });

  it("zeigt das Routinen-Panel neben dem Chat", async () => {
    const { container } = render(<App />);
    await act(async () => { useNav.getState().go({ kind: "routinen" }); });
    expect(container.querySelector('aside[aria-label^="Routines"]')).toBeTruthy();
    expect(container.querySelector("textarea, [contenteditable]")).toBeTruthy();
  });

  it("unterdrückt das WebKit-Standardmenü, Orbits eigene Rechtsklick-Menüs bleiben", async () => {
    const { container } = render(<App />);
    expect(fireEvent.contextMenu(container)).toBe(false); // preventDefault: kein „Neu laden“
    await waitFor(() => expect(container.querySelector("[data-kopf-pille]")).toBeTruthy());
    fireEvent.contextMenu(container.querySelector("[data-kopf-pille]") as HTMLElement);
    expect(document.body.querySelector('[role="menu"]')).not.toBeNull();
  });

  it("Klick auf die Kopf-Pille schaltet die rechte Leiste um", async () => {
    const { container, getByRole } = render(<App />);
    await waitFor(() => expect(container.querySelector("[data-kopf-pille]")).toBeTruthy());
    const pille = container.querySelector("[data-kopf-pille]") as HTMLElement;
    expect(container.querySelector('aside[aria-label^="Details for"]')).toBeNull();
    fireEvent.click(pille);
    expect(container.querySelector('aside[aria-label^="Details for"]')).toBeTruthy();
    expect(getByRole("separator", { name: "Width of the right sidebar" })).toBeTruthy();
    fireEvent.click(pille);
    expect(container.querySelector('aside[aria-label^="Details for"]')).toBeNull();
  });

  it("klappt die linke Leiste per Knopf und ⌘B ein und aus", async () => {
    const { container, getByLabelText } = render(<App />);
    await waitFor(() => expect(container.querySelector('[data-seitenleiste="offen"]')).toBeTruthy());
    fireEvent.click(getByLabelText("Hide sidebar"));
    expect(container.querySelector('[data-seitenleiste="eingeklappt"]')).toBeTruthy();
    expect(JSON.parse(localStorage.getItem("orbit.leisten.v1")!).klein).toBe(true);
    fireEvent.keyDown(window, { key: "b", metaKey: true });
    expect(container.querySelector('[data-seitenleiste="offen"]')).toBeTruthy();
    expect(JSON.parse(localStorage.getItem("orbit.leisten.v1")!).klein).toBe(false);
  });

  it("ändert die Breite der Leisten per Ziehen und Pfeiltasten, mit Grenzen", async () => {
    window.innerWidth = 1440;
    Element.prototype.setPointerCapture = () => {};
    Element.prototype.releasePointerCapture = () => {};
    Element.prototype.hasPointerCapture = () => true;
    const { container, getByRole } = render(<App />);
    await waitFor(() => expect(container.querySelector('[data-seitenleiste="offen"]')).toBeTruthy());
    const links = getByRole("separator", { name: "Width of the sidebar" });
    const leiste = links.parentElement as HTMLElement;
    leiste.getBoundingClientRect = () => ({ width: LEISTE.links.std } as DOMRect);
    fireEvent.pointerDown(links, { clientX: 336, pointerId: 1, button: 0 });
    fireEvent.pointerMove(links, { clientX: 400, pointerId: 1 });
    expect(leiste.style.width).toBe("400px");
    fireEvent.pointerMove(links, { clientX: 2000, pointerId: 1 });
    expect(leiste.style.width).toBe(`${LEISTE.links.max}px`);
    fireEvent.pointerUp(links, { clientX: 2000, pointerId: 1 });
    expect(useNav.getState().sidebarWidth).toBe(LEISTE.links.max);
    fireEvent.doubleClick(links);
    expect(useNav.getState().sidebarWidth).toBe(LEISTE.links.std);

    await act(async () => { useNav.getState().setPanel("uebersicht"); });
    const rechts = getByRole("separator", { name: "Width of the right sidebar" });
    fireEvent.keyDown(rechts, { key: "ArrowLeft" });
    expect(useNav.getState().panelWidth).toBe(LEISTE.rechts.std + 16);
    fireEvent.keyDown(rechts, { key: "ArrowRight" });
    expect(useNav.getState().panelWidth).toBe(LEISTE.rechts.std);
  });
});
