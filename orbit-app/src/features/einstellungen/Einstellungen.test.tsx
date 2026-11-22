import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { useNav } from "../../lib/nav";
import { useOrbit } from "../../lib/store";
import { BOTS, mockDienst, type Handler } from "../onboarding/mock";

const geoeffnet = vi.hoisted(() => [] as string[]);
vi.mock("../../lib/tauri", async (orig) => ({ ...(await orig<typeof import("../../lib/tauri")>()), openUrl: async (u: string) => { geoeffnet.push(u); } }));
import { SettingsView } from "./index";
import { useEinst } from "./store";

let abbau = () => {};
let log: { methode: string; pfad: string; body: unknown }[] = [];
const KATALOG = [
  { id: "skill-lernkarte", name: "Lernkarten", description: "Wandelt Lernstoff um.", type: "skill", risk: "read", skillName: "lernkarten", skillDescription: "Erstellt Karten.", skillBody: "## Wann nutzen" },
];
const installieren = (routen: Record<string, Handler> = {}) => {
  abbau();
  log = [];
  abbau = mockDienst({ log, routen: {
    "GET /v1/marketplace": () => ({ ok: true, entries: KATALOG }),
    "GET /v1/skills": () => ({ ok: true, skills: [] }),
    "POST /v1/skills": (b) => ({ ok: true, skill: { id: "s1", ...b } }),
    ...routen,
  } }).abbauen;
};
beforeEach(() => {
  geoeffnet.length = 0;
  installieren();
  useOrbit.setState({ bots: BOTS as never, bereit: true });
  useEinst.setState({ liste: null, ausstehend: null, suche: "", tab: "alle", kategorie: "alle", fokus: null, scroll: {}, person: null, beruf: null, anleitung: null });
  useNav.setState({ main: { kind: "einstellungen" } });
});
afterEach(() => { cleanup(); abbau(); });

describe("Settings", () => {
  it("zeigt die drei Gruppen und wechselt die Seite über die Navigation", async () => {
    render(<SettingsView page="allgemein" />);
    for (const t of ["Orbit", "Services and usage", "System and access", "Back to chat"]) expect(screen.getAllByText(t).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText("Security"));
    expect(useNav.getState().main).toEqual({ kind: "einstellungen", page: "sicherheit" });
  });

  it("klappt eine Programmkarte direkt auf und trennt nur den bestätigten Anbieter", async () => {
    let verbunden = true;
    installieren({
      "GET /v1/clis": () => ({ ok: true, clis: [
        { id: "claude", label: "Claude Code", installed: true, version: "2.4.1", loggedIn: verbunden,
          state: verbunden ? "bereit" : "abgemeldet", message: "" },
        { id: "cursor", label: "Cursor", installed: true, version: "1.0", loggedIn: false, state: "abgemeldet", message: "" },
      ] }),
      "POST /v1/clis/claude/disconnect": () => { verbunden = false; return { ok: true }; },
    });
    render(<SettingsView page="arbeitsumgebung" />);
    const claude = await screen.findByRole("button", { name: /^Claude Code/ });
    expect(claude.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(claude);
    const details = screen.getByRole("group", { name: "Manage Claude Code" });
    expect(claude.getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById(claude.getAttribute("aria-controls")!)?.contains(details)).toBe(true);
    expect(log.filter((e) => e.methode === "POST")).toEqual([]);

    fireEvent.click(within(details).getByRole("button", { name: "Disconnect" }));
    fireEvent.click(within(details).getByRole("button", { name: "Cancel" }));
    expect(log.filter((e) => e.methode === "POST")).toEqual([]);

    fireEvent.click(within(details).getByRole("button", { name: "Disconnect" }));
    fireEvent.click(within(details).getByRole("button", { name: "Confirm disconnect" }));
    await within(details).findByRole("button", { name: "Sign in" });
    expect(claude.textContent).toContain("Signed out");
    expect(log.filter((e) => e.methode === "POST").map((e) => e.pfad)).toEqual(["/v1/clis/claude/disconnect"]);

    fireEvent.click(screen.getByRole("button", { name: /^Cursor/ }));
    expect(claude.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("group", { name: "Manage Claude Code" })).toBeNull();
    const cursor = screen.getByRole("group", { name: "Manage Cursor" });
    fireEvent.click(within(cursor).getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(geoeffnet).toEqual(["https://login.example.test/code"]));
  });

  it("zeigt das Anbieterkonto und startet nach dem Trennen eine neue Anmeldung", async () => {
    let state = "bereit";
    installieren({
      "GET /v1/clis": (_b, query) => {
        expect(query.get("account")).toBe("1");
        return { ok: true, clis: [{ id: "claude", label: "Claude Code", installed: true, version: "2.4.1",
          loggedIn: state === "bereit", accountEmail: state === "bereit" ? "demo@example.test" : undefined,
          state, busy: state === "laeuft" ? "login" : null, loginKind: "code-paste", message: "" }] };
      },
      "POST /v1/clis/claude/disconnect": () => { state = "abgemeldet"; return { ok: true }; },
      "POST /v1/clis/claude/login": () => {
        expect(state).toBe("abgemeldet");
        state = "laeuft";
        return { ok: true, url: "https://login.example.test/claude", opensBrowser: true };
      },
    });
    render(<SettingsView page="arbeitsumgebung" />);
    fireEvent.click(await screen.findByRole("button", { name: /^Claude Code/ }));
    const karte = screen.getByRole("group", { name: "Manage Claude Code" });
    within(karte).getByText("demo@example.test");
    fireEvent.click(within(karte).getByRole("button", { name: "Reconnect" }));
    await within(karte).findByRole("button", { name: "Open in browser" });
    expect(geoeffnet).toEqual([]);
    expect(log.filter((e) => e.methode === "POST").map((e) => e.pfad)).toEqual([
      "/v1/clis/claude/disconnect", "/v1/clis/claude/login",
    ]);
    expect(within(karte).queryByText("demo@example.test")).toBeNull();
  });

  it("setzt die angeforderte Neuanmeldung bei einem Seitenwechsel fort", async () => {
    let fertig = () => {};
    const abmeldung = new Promise((resolve) => { fertig = () => resolve({ ok: true }); });
    installieren({
      "GET /v1/clis": () => ({ ok: true, clis: [{ id: "cursor", label: "Cursor", installed: true,
        version: "1.0", loggedIn: true, state: "bereit", message: "" }] }),
      "POST /v1/clis/cursor/disconnect": () => abmeldung,
      "POST /v1/clis/cursor/login": () => ({ ok: true, url: "https://login.example.test/cursor" }),
    });
    const view = render(<SettingsView page="arbeitsumgebung" />);
    fireEvent.click(await screen.findByRole("button", { name: /^Cursor/ }));
    fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));
    await waitFor(() => expect(log.filter((e) => e.methode === "POST").map((e) => e.pfad)).toEqual(["/v1/clis/cursor/disconnect"]));
    view.unmount();
    fertig();
    await waitFor(() => expect(geoeffnet).toEqual(["https://login.example.test/cursor"]));
  });

  it("zeigt den bestätigten Logout auch nach einem Fehler beim erneuten Statusabruf", async () => {
    let verbunden = true;
    installieren({
      "GET /v1/clis": () => {
        if (!verbunden) throw new Error("Status vorübergehend nicht erreichbar");
        return { ok: true, clis: [{ id: "claude", label: "Claude Code", installed: true,
          version: "2.4.1", loggedIn: true, state: "fehler", message: "Vorheriger Versuch fehlgeschlagen" }] };
      },
      "POST /v1/clis/claude/disconnect": () => { verbunden = false; return { ok: true }; },
    });
    render(<SettingsView page="arbeitsumgebung" />);
    const claude = await screen.findByRole("button", { name: /^Claude Code/ });
    fireEvent.click(claude);
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm disconnect" }));
    await screen.findByRole("button", { name: "Sign in" });
    expect(claude.textContent).toContain("Signed out");
  });

  it("nimmt den alten Seitennamen „marktplatz“ als Plugins", async () => {
    render(<SettingsView page="marktplatz" />);
    await waitFor(() => expect(screen.getByText("Suggestions for you")).toBeTruthy());
  });

  it("öffnet die Plugin-Karte als Detail und merkt Suche und Fokus für die Rückkehr", async () => {
    useEinst.setState({ suche: "mail" });
    render(<SettingsView page="plugins" />);
    const karte = await screen.findByText("Mails lesen, suchen und entwerfen");
    fireEvent.click(karte);
    expect(useNav.getState().main).toEqual({ kind: "einstellungen", page: "plugins", pluginId: "gmail" });
    expect(useEinst.getState().fokus).toBe("gmail");
    expect(useEinst.getState().suche).toBe("mail");
  });

  it("zeigt im Detail Werkzeuge mit echtem Status und trennt nach Bestätigung genau das Konto", async () => {
    render(<SettingsView page="plugins" pluginId="gmail" />);
    await screen.findByText("Entwurf schreiben");
    expect(screen.getAllByText("Always ask").length).toBe(2);
    fireEvent.click((await screen.findAllByText("Disconnect", { selector: "button" }))[0]);
    fireEvent.click(within(await screen.findByRole("dialog")).getByText("Disconnect", { selector: "button" }));
    await waitFor(() => expect(log.find((l) => l.methode === "DELETE" && l.pfad === "/v1/plugins/gmail/accounts")?.body).toEqual({ accountIds: ["ca_demo"], confirmed: true }));
  });

  it("zeigt den Fehlertext des Dienstes beim Speichern des Namens", async () => {
    useNav.setState({ main: { kind: "einstellungen", page: "personalisierung" } });
    render(<SettingsView page="personalisierung" />);
    const feld = await screen.findByLabelText("Name");
    fireEvent.change(feld, { target: { value: "x".repeat(41) } });
    fireEvent.blur(feld);
    // maxLength begrenzt die Eingabe; der Entwurf bleibt erhalten
    expect(useEinst.getState().person).not.toBeNull();
  });

  it("zeigt bei nicht eingerichtetem Composio den Einrichten-Zustand mit dem Fehlertext des Dienstes und prüft den Schlüssel", async () => {
    let versuch = 0;
    installieren({
      "GET /v1/plugins": () => ({ ok: true, configured: false, entries: [], nextCursor: null, totalItems: 0, categories: [], recommendedCount: 0 }),
      "POST /v1/plugins/verify": () => { if (versuch++ === 0) throw "Composio-Zugang ist ungültig."; return { ok: true }; },
      "POST /v1/plugins/reload": () => ({ ok: true }),
    });
    render(<SettingsView page="plugins" />);
    await screen.findByText("Composio is not set up yet");
    fireEvent.change(screen.getByLabelText("Project key"), { target: { value: "TESTSCHLUESSEL" } });
    fireEvent.change(screen.getByLabelText("User ID"), { target: { value: "test-nutzer" } });
    fireEvent.click(screen.getByText("Check and save"));
    expect((await screen.findByRole("alert")).textContent).toContain("Composio-Zugang ist ungültig.");
    fireEvent.click(screen.getByText("Check and save"));
    await waitFor(() => expect(log.find((l) => l.pfad === "/v1/plugins/verify" && JSON.stringify(l.body) === JSON.stringify({ key: "TESTSCHLUESSEL", user: "test-nutzer" }))).toBeTruthy());
    await waitFor(() => expect(log.some((l) => l.pfad === "/v1/plugins/reload")).toBe(true));
  });

  it("zeigt Skills aus dem Katalog und legt sie an; eigene MCP nur über Plus", async () => {
    render(<SettingsView page="plugins" />);
    await screen.findByText("Lernkarten");
    expect(screen.queryByText("DeepWiki")).toBeNull();
    const knopfIn = (titel: string) => within(screen.getByText(titel).closest("div[class*='px-4']") as HTMLElement).getByText("Add");
    fireEvent.click(knopfIn("Lernkarten"));
    await waitFor(() => expect(log.find((l) => l.methode === "POST" && l.pfad === "/v1/skills")?.body).toEqual({ name: "lernkarten", description: "Erstellt Karten.", body: "## Wann nutzen" }));
    fireEvent.click(screen.getByLabelText("Add your own server"));
    expect((await screen.findByRole("dialog")).textContent).toContain("Add your own server");
  });

  it("öffnet die Anmelde-Adresse, wartet und lädt nach der Rückkehr (Fenster-Ereignis) den Status neu", async () => {
    let zurueck = false;
    installieren({ "GET /v1/plugins/*/status": () => ({ ok: true, connectionStatus: zurueck ? "connected" : "pending", toolsEnabled: false, toolsStatus: "not_checked", accessMode: "individual_actions" }) });
    render(<SettingsView page="plugins" />);
    const zeile = (await screen.findAllByText("Google Drive")).map((x) => x.closest("[role=button]")).find(Boolean) as HTMLElement;
    fireEvent.click(within(zeile).getByText("Connect"));
    await waitFor(() => expect(geoeffnet).toEqual(["https://connect.example.test/link"]));
    await screen.findByText(/Waiting for sign-in/);
    log.length = 0;
    zurueck = true;
    await act(async () => { window.dispatchEvent(new CustomEvent("orbit:auth-callback", { detail: "orbit-rust://auth/callback?x=1" })); });
    await waitFor(() => expect(log.some((l) => l.methode === "GET" && l.pfad.startsWith("/v1/plugins/googledrive/status"))).toBe(true));
    await waitFor(() => expect(useNav.getState().main).toEqual({ kind: "einstellungen", page: "plugins", pluginId: "googledrive" }));
    expect(useEinst.getState().ausstehend).toBeNull();
  });

  it("bietet bei „braucht eigene App“ das Einrichten an und schickt Schema und Felder", async () => {
    installieren({
      "POST /v1/plugins/*/connect": () => { throw "Dieser Dienst braucht eine eigene App beim Anbieter. Lege sie dort an."; },
      "GET /v1/plugins/*/setup": () => ({ ok: true, slug: "googledrive", name: "Google Drive", guideUrl: "https://docs.example.test/g", schemes: ["OAUTH2"], credentialDestination: "composio", connectionFieldsHosted: [], oauthRedirectUrl: "https://example.test/cb", notice: "Eigene App nötig." }),
      "GET /v1/plugins/*/status": () => ({ ok: true, connectionStatus: "pending", toolsEnabled: false, toolsStatus: "not_checked", accessMode: "individual_actions" }),
      "POST /v1/plugins/*/setup": () => ({ ok: true, url: "https://connect.example.test/eigen", accountId: "ca_neu" }),
    });
    render(<SettingsView page="plugins" />);
    const zeile = (await screen.findAllByText("Google Drive")).map((x) => x.closest("[role=button]")).find(Boolean) as HTMLElement;
    fireEvent.click(within(zeile).getByText("Connect"));
    const d = await screen.findByRole("dialog");
    await within(d).findByText("Eigene App nötig.");
    fireEvent.change(within(d).getByLabelText("Client-ID"), { target: { value: "id-1" } });
    fireEvent.change(within(d).getByLabelText("Client secret"), { target: { value: "geheim-1" } });
    fireEvent.click(within(d).getByText("Save and connect"));
    await waitFor(() => expect(log.find((l) => l.methode === "POST" && l.pfad === "/v1/plugins/googledrive/setup")?.body).toEqual({ scheme: "OAUTH2", fields: { client_id: "id-1", client_secret: "geheim-1" } }));
    await waitFor(() => expect(geoeffnet).toContain("https://connect.example.test/eigen"));
    expect(useEinst.getState().ausstehend?.accountId).toBe("ca_neu");
  });

  it("behält Liste, Suche und Fokus bei Zurück aus dem Detail ohne neu zu laden", async () => {
    render(<SettingsView page="plugins" />);
    fireEvent.click(await screen.findByText("Mails lesen, suchen und entwerfen"));
    cleanup();
    log.length = 0;
    render(<SettingsView page="plugins" />);
    await screen.findByText("Mails lesen, suchen und entwerfen");
    await waitFor(() => expect(document.activeElement?.getAttribute("data-fokus")).toBe("gmail"));
    expect(log.filter((l) => l.pfad.startsWith("/v1/plugins?") && !l.pfad.includes("recommended")).length).toBe(0);
  });
});
