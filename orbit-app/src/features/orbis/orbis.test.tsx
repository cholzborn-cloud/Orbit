import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/api", () => ({
  createBot: vi.fn(async () => ({ ok: true, id: "n", chatId: "c-n" })),
  updateBot: vi.fn(async () => ({ ok: true, id: "mira" })),
  deleteBot: vi.fn(async () => ({ ok: true })),
  createGroup: vi.fn(async () => ({ ok: true, id: "g" })),
  updateGroup: vi.fn(async () => ({ ok: true })),
  deleteGroup: vi.fn(async () => ({ ok: true })),
  clearMessages: vi.fn(async () => ({ ok: true })),
  getLibrary: vi.fn(async () => ({ ok: true, files: [], limitations: [], truncated: false })),
  getLibraryFile: vi.fn(),
}));
vi.mock("../../lib/tauri", () => ({ apiRequest: vi.fn(async () => ({ ok: true, entries: [], state: "sleeping" })), apiStream: vi.fn() }));

import * as api from "../../lib/api";
import { useNav } from "../../lib/nav";
import { useOrbit } from "../../lib/store";
import { apiRequest } from "../../lib/tauri";
import { useDesktop } from "../routinen/computer";
import { EditorDialogs } from "./Editor";
import { PillMenu } from "./Menus";
import { OrbiPanel } from "./Panel";
import { useOrbisData } from "./data";
import type { Routine } from "../../lib/types";
import { Eingabe } from "../chat/eingabe";
import { RoutineDialog } from "../routinen/RoutineDialog";

const bot = (id: string, name: string, extra = {}) => ({
  id, chatId: `c-${id}`, name, avatar: "strobi", color: "#de3a8e", job: "Termine", instructions: "", isMain: false, onboardingDone: true, look: null, lastMessageAt: null, ...extra,
});
const mira = bot("mira", "Mira", { isMain: true });
const nova = bot("nova", "Nova", { job: "Gliederungen" });

beforeEach(() => {
  vi.clearAllMocks();
  useOrbit.setState({ bots: [mira, nova], main: mira, groups: [], selectedChatId: "c-mira", routines: [], routineTrash: [], loadBots: vi.fn(async () => {}), loadChats: vi.fn(async () => {}) } as never);
  useNav.setState({ editor: null, panel: null, main: { kind: "chat" } });
});
afterEach(cleanup);

describe("Orbis", () => {
  it("zeigt den Computer in der Übersicht auch ohne eingerichtete Umgebung", async () => {
    useDesktop.setState({ desk: {} });
    vi.mocked(apiRequest).mockResolvedValueOnce({ ok: true, state: "unconfigured" });
    render(<OrbiPanel botId="mira" />);

    const detail = await screen.findByText("Not set up");
    const computer = detail.closest("button");
    expect(computer).not.toBeNull();
    for (const text of ["Today", "Up next", "Last learned"]) {
      expect(screen.queryByRole("heading", { name: text })).toBeNull();
    }
    fireEvent.click(computer!);
    expect(useNav.getState().main).toEqual({ kind: "computer", botId: "mira" });
  });

  it("öffnet ein freigegebenes Bild direkt aus dem Bilder-Filter der Bibliothek", async () => {
    const base64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==";
    const bild = { id: "bild", filename: "Freigegeben.png", kind: "file", mediaType: "image/png", size: 70, createdAt: "" };
    vi.mocked(api.getLibrary).mockResolvedValueOnce({ ok: true, files: [bild], limitations: [], truncated: false });
    vi.mocked(api.getLibraryFile).mockResolvedValue({ ok: true, file: { ...bild, data: base64 } });
    useOrbisData.setState({ library: {} });
    useNav.setState({ panel: "bibliothek" });
    render(<OrbiPanel botId="mira" />);
    fireEvent.click(screen.getByRole("button", { name: "Images" }));
    fireEvent.click(await screen.findByRole("button", { name: "Freigegeben.png · Open preview" }));
    const vorschau = await screen.findByRole("dialog", { name: "Freigegeben.png" });
    expect(within(vorschau).getByRole("img").getAttribute("src")).toBe(`data:image/png;base64,${base64}`);
    expect(api.getLibraryFile).toHaveBeenCalledWith("mira", "bild");
  });

  it("PillMenu zeigt die Einträge und öffnet das Panel", async () => {
    const onClose = vi.fn();
    render(<PillMenu anchor={{ x: 851, y: 10, width: 75, height: 34 }} onClose={onClose} />);
    for (const t of ["Details", "Edit", "Routines", "Files", "Add to group", "Clear chat", "Delete Mira"]) screen.getByText(t);
    await act(async () => { fireEvent.click(screen.getByText("Files")); });
    await waitFor(() => expect(useNav.getState().panel).toBe("bibliothek"));
    expect(onClose).toHaveBeenCalled();
  });

  it("Editor speichert Form und Namen per PATCH", async () => {
    useNav.setState({ editor: { kind: "orbi", botId: "nova" } });
    render(<EditorDialogs />);
    fireEvent.click(screen.getByRole("radio", { name: "Kirby" }));
    fireEvent.click(screen.getByRole("radio", { name: "blau" }));
    fireEvent.click(screen.getByRole("tab", { name: "Personalize" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Nova 2" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save" })); });
    expect(api.updateBot).toHaveBeenCalledWith("nova", expect.objectContaining({ name: "Nova 2", avatar: "kirby", color: "#3378ec", isMain: false }));
  });

  it("neuer Hauptorbi braucht Bestätigung", async () => {
    useNav.setState({ editor: { kind: "orbi", botId: "nova", tab: "personalisieren" } });
    render(<EditorDialogs />);
    fireEvent.click(screen.getByRole("switch", { name: "Main Orbi" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(api.updateBot).not.toHaveBeenCalled();
    screen.getByText(/Mira stays your Orbi for Termine/);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Make Nova main" })); });
    expect(api.updateBot).toHaveBeenCalledWith("nova", expect.objectContaining({ isMain: true }));
  });

  it("Gruppe anlegen", async () => {
    useNav.setState({ editor: { kind: "gruppe" } });
    render(<EditorDialogs />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Präsentation" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /Mira/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Nova/ }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Create group" })); });
    expect(api.createGroup).toHaveBeenCalledWith("Präsentation", ["mira", "nova"]);
  });

  it("Routine erstellen schickt eine Nachricht an den Orbi", async () => {
    const send = vi.fn(async () => {});
    useOrbit.setState({ send, selectChat: vi.fn(async () => {}) } as never);
    render(<RoutineDialog bot={mira as never} onClose={() => {}} />);
    fireEvent.click(screen.getByText("Summarize mail"));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Create routine" })); });
    await waitFor(() => expect(send).toHaveBeenCalled());
    const [chatId, text, , botId] = send.mock.calls[0] as unknown as [string, string, unknown, string];
    expect(chatId).toBe("c-mira");
    expect(botId).toBe("mira");
    expect(text).toContain("Every evening, summarize my mail");
    expect(text).toContain("every day at 18:00");
  });

  describe("Übersicht", () => {
    const iso = (h: number) => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(h, 0, 0, 0); return d.toISOString(); };
    const routine = (id: string, name: string, enabled: boolean, next: string | null, botId = "mira", extra = {}): Routine => ({
      bot: { id: botId, name: "Mira", avatar: "strobi" },
      automation: {
        id, botId, name, prompt: "x", schedule: { kind: "daily", at: "18:00" }, timezone: "Europe/Berlin", target: "same", chatId: null, notify: "app", model: null, effort: null,
        context: true, enabled, pausedReason: null, lastRunAt: null, resumedAt: null, nextRunAt: next, deletedAt: null, createdAt: iso(9), ...extra,
      },
    } as Routine);

    it("zeigt nur die Routinen dieses Orbis mit Status und öffnet sie per Klick", async () => {
      useOrbit.setState({
        routines: [routine("a", "Mails zusammenfassen", true, iso(18)), routine("b", "Monatsbericht", false, null), routine("c", "Fremd", true, iso(7), "nova")],
        runs: { a: { status: "running" } },
      } as never);
      render(<OrbiPanel botId="mira" />);
      const sec = screen.getByRole("region", { name: "Routines" });
      expect(sec.textContent).toContain("Mails zusammenfassen");
      expect(sec.textContent).toContain("Running now");
      expect(sec.textContent).toContain("Monatsbericht");
      expect(sec.textContent).toContain("Paused");
      expect(sec.textContent).not.toContain("Fremd");
      await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Monatsbericht/ })); });
      screen.getByText("Edit routine");
    });

    it("zeigt den nächsten Lauf und verlinkt auf alle Routinen", async () => {
      useOrbit.setState({
        routines: ["a", "b", "c", "d"].map((id, i) => routine(id, `R${id}`, true, iso(8 + i))),
        runs: {},
      } as never);
      render(<OrbiPanel botId="mira" />);
      const sec = screen.getByRole("region", { name: "Routines" });
      expect(sec.textContent).toContain("Next run");
      expect(sec.textContent).not.toContain("Rd");
      fireEvent.click(screen.getByRole("button", { name: "All 4" }));
      expect(useNav.getState().main).toEqual({ kind: "routinen" });
    });

    it("leerer Zustand ohne Routinen, ohne Verwalten-Link", () => {
      render(<OrbiPanel botId="mira" />);
      screen.getByText("No routines yet. Tell Mira what should run regularly.");
      expect(screen.queryByRole("button", { name: "Manage" })).toBeNull();
    });

    it("Kacheln führen zu Aktivität und Bibliothek und zeigen echte Zahlen", async () => {
      useOrbisData.setState({
        library: { mira: { files: [{ id: "f", name: "a.pdf", size: 2048, createdAt: new Date().toISOString() }, { id: "g", name: "b.pdf", size: 2048, createdAt: new Date().toISOString() }] as never, truncated: false, loaded: true } },
      });
      vi.mocked(api.getLibrary).mockResolvedValue({ ok: true, files: [{ id: "f" }, { id: "g" }] as never, limitations: [], truncated: false });
      render(<OrbiPanel botId="mira" />);
      const bib = await screen.findByRole("button", { name: /Library\s*2 files/ });
      fireEvent.click(bib);
      expect(useNav.getState().panel).toBe("bibliothek");
      cleanup();
      useNav.setState({ panel: null });
      render(<OrbiPanel botId="mira" />);
      fireEvent.click(screen.getByRole("button", { name: /Activity\s*Nothing yet/ }));
      expect(useNav.getState().panel).toBe("aktivitaet");
    });

    it("zeigt alle Gedächtniseinträge des angeklickten Orbis samt Inhalt", async () => {
      vi.mocked(apiRequest).mockImplementation((async (_m: string, path: string) =>
        path.endsWith("/mira/memory") ? { ok: true, entries: [
          { name: "Arbeit", description: "Arbeitszeit", body: "Montags ab neun", updatedAt: new Date().toISOString() },
          { name: "Schreibstil", description: "Antworten", body: "Kurze Absätze" },
        ] } : { ok: true, entries: [], state: "sleeping" }) as never);
      render(<OrbiPanel botId="mira" />);
      fireEvent.click(await screen.findByRole("button", { name: /Memory.*2 entries/ }));
      expect(await screen.findByRole("dialog", { name: "Memory of Mira" })).toBeTruthy();
      expect(screen.getAllByRole("listitem")).toHaveLength(2);
      screen.getByText("Montags ab neun");
      screen.getByText("Kurze Absätze");
      fireEvent.keyDown(document, { key: "Escape" });
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("setzt einen ungesendeten Routinenentwurf ins Chatfeld und erhält vorhandenen Text", () => {
      const senden = vi.fn();
      render(<><OrbiPanel botId="mira" /><Eingabe chatId="c-mira" ziel="Mira" gruppe={false}
        sendeFarbe="#eee" laeuft={false} onSenden={senden} onStopp={() => {}} /></>);
      const feld = screen.getByRole<HTMLTextAreaElement>("textbox");
      fireEvent.change(feld, { target: { value: "Schon geschrieben" } });
      const plus = screen.getByRole("button", { name: "Create routine" });
      fireEvent.click(plus);
      fireEvent.click(plus);
      expect(feld.value).toBe(`Schon geschrieben

Please create a routine for me.

Do [task].
Run it [when and how often].
Send me the result [here in this chat or in a new chat].

Ask briefly if anything is missing before you set it up.`);
      expect(feld.value.slice(feld.selectionStart, feld.selectionEnd)).toBe("[task]");
      expect(document.activeElement).toBe(feld);
      expect(senden).not.toHaveBeenCalled();
    });
  });
});
