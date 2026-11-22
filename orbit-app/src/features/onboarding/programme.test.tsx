import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const geoeffnet: string[] = [];
vi.mock("./dienst", async (orig) => ({ ...(await orig<typeof import("./dienst")>()), openUrl: async (u: string) => { geoeffnet.push(u); } }));

import { ModelleSchritt } from "./schritte";
import { mockDienst } from "./mock";
import { useErststart } from "./store";
import { useOrbit } from "../../lib/store";
import { fehlerVon, schrittVon, statusText, vorgangVon } from "./programme";

let abbau = () => {};
let log: { methode: string; pfad: string; body: unknown }[] = [];
let z: ReturnType<typeof mockDienst>["zustand"];
let schreib: Record<string, (b: any, q: URLSearchParams, t: string[]) => unknown> = {};

const cli = (id: string, p: Record<string, unknown>) => z.clis.find((c: any) => c.id === id) && Object.assign(z.clis.find((c: any) => c.id === id), p);
/** Ereignis des Dienstes, wie es der Speicher aus /v1/events ablegt. */
const ereignis = (id: string, phase: string, message = "") => act(() => { useOrbit.setState((s) => ({ cliSetup: { ...s.cliSetup, [id]: { phase, message, at: Date.now() + Math.random() } } })); });

function start() {
  const m = mockDienst({ log, routen: {
    "POST /v1/clis/*/*": (b, q, t) => schreib["POST"]?.(b, q, t) ?? { ok: true },
    "POST /v1/clis/*/login/input": (b, q, t) => schreib["EINGABE"]?.(b, q, t) ?? { ok: true },
  } });
  z = m.zustand; abbau = m.abbauen;
  z.clis.splice(0, z.clis.length,
    { id: "claude", label: "Claude Code", installed: true, version: "2.4.1", loggedIn: true, state: "bereit", message: "" },
    { id: "codex", label: "Codex", installed: true, version: "0.1", loggedIn: false, state: "abgemeldet", message: "Codex is installed, but not signed in." },
    { id: "cursor", label: "Cursor", installed: false, version: null, loggedIn: false, state: "fehlt", message: "Cursor is not installed." },
    { id: "agy", label: "Antigravity", installed: true, version: "1.5", loggedIn: false, state: "abgemeldet", message: "" },
  );
}

beforeEach(() => {
  log = []; geoeffnet.length = 0; schreib = {};
  useErststart.getState().zuruecksetzen();
  useOrbit.setState({ cliSetup: {} });
  start();
});
afterEach(() => { cleanup(); abbau(); });

const warte = (t: string | RegExp) => waitFor(() => expect(screen.getByText(t)).toBeTruthy());
const posts = (art: string) => log.filter((l) => l.methode === "POST" && l.pfad.endsWith(`/${art}`));
const zeile = (id: string) => document.querySelector(`[data-karte="${id}"]`) as HTMLElement;
/** Kachel per Name wählen. */
const kachel = (name: string) => screen.getAllByRole("checkbox").find((b) => b.textContent?.includes(name))!;

const LANG = { timeout: 4000 };
const letztes = (t: string[]) => t[t.length - 1];

describe("Programme verbinden", () => {
  it("lässt Claude seinen Browser öffnen und bietet den manuellen Link separat an", async () => {
    cli("claude", { state: "abgemeldet", loggedIn: false });
    schreib["POST"] = (_b, _q, t) => {
      if (letztes(t) === "login") {
        cli("claude", { state: "laeuft", busy: "login", loginKind: "code-paste" });
        return { ok: true, url: "https://claude.example.test/fallback", opensBrowser: true };
      }
      return { ok: true };
    };
    render(<ModelleSchritt />);
    await waitFor(() => expect((kachel("Claude Code") as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(kachel("Claude Code"));
    const manuell = await screen.findByRole("button", { name: "Open in browser" });
    expect(geoeffnet).toEqual([]);
    fireEvent.click(manuell);
    await waitFor(() => expect(geoeffnet).toEqual(["https://claude.example.test/fallback"]));
  });

  it("zeigt den Stand je Programm und erlaubt Weiter, wenn eines läuft", async () => {
    render(<ModelleSchritt />);
    await waitFor(() => expect(kachel("Claude Code").getAttribute("aria-checked")).toBe("true"));
    expect(kachel("Cursor").getAttribute("aria-checked")).toBe("false");
    expect((screen.getByText("Continue").closest("button") as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText("Later")).toBeNull();
    expect(zeile("claude")).toBeNull();
  });

  it("zeigt ohne verbundenes Programm nur „Später“, mit verbundenem nur „Weiter“", async () => {
    z.clis[0].state = "abgemeldet"; z.clis[0].loggedIn = false;
    render(<ModelleSchritt />);
    await waitFor(() => expect(kachel("Cursor")).toBeTruthy());
    await waitFor(() => expect(log.some((l) => l.pfad.startsWith("/v1/clis"))).toBe(true));
    expect(screen.queryByText("Continue")).toBeNull();
    fireEvent.click(screen.getByText("Later"));
    expect(useErststart.getState().schritt).toBe("dienste");
  });

  it("ein Klick: fehlt → installieren → anmelden (Adresse im Browser) → verbunden, ohne zweiten Klick", async () => {
    schreib["POST"] = (_b, _q, t) => {
      if (letztes(t) === "install") cli("cursor", { state: "laeuft", busy: "install", message: "Installation in progress." });
      if (letztes(t) === "login") { cli("cursor", { state: "laeuft", busy: "login", loginUrl: "https://cursor.example.test/login" }); return { ok: true, url: "https://cursor.example.test/login", code: null }; }
      return { ok: true };
    };
    render(<ModelleSchritt />);
    await waitFor(() => expect(kachel("Cursor")).toBeTruthy());
    fireEvent.click(kachel("Cursor"));
    await waitFor(() => expect(zeile("cursor").getAttribute("data-vorgang")).toBe("install"));
    expect(screen.getByRole("progressbar")).toBeTruthy();
    expect(document.querySelectorAll("[data-karte]").length).toBe(1);
    expect(screen.queryByText("Install", { selector: "button" })).toBeNull();
    await ereignis("cursor", "install", "Installing Cursor…");
    await warte("Installing Cursor…");
    // Installation fertig: der Dienst meldet done, die Anmeldung startet von allein.
    cli("cursor", { state: "abgemeldet", busy: null, installed: true });
    await ereignis("cursor", "done", "Cursor is installed.");
    await waitFor(() => expect(posts("login").length).toBe(1));
    await waitFor(() => expect(geoeffnet).toEqual(["https://cursor.example.test/login"]));
    await waitFor(() => expect(zeile("cursor").getAttribute("data-vorgang")).toBe("login"));
    expect(posts("install").length).toBe(1);
    // Anmeldung fertig: Verbunden, Karte schrumpft zurück.
    cli("cursor", { state: "bereit", busy: null, loggedIn: true, loginUrl: null });
    await ereignis("cursor", "done", "Cursor is signed in.");
    await waitFor(() => expect(kachel("Cursor").getAttribute("aria-checked")).toBe("true"));
    await waitFor(() => expect(zeile("cursor")).toBeNull(), LANG);
    expect(posts("login").length).toBe(1);
  });

  it("fängt Mehrfachklicks ab", async () => {
    let n = 0;
    schreib["POST"] = (_b, _q, t) => { if (letztes(t) === "install") { n++; cli("cursor", { state: "laeuft", busy: "install" }); } return { ok: true }; };
    render(<ModelleSchritt />);
    await waitFor(() => expect(kachel("Cursor")).toBeTruthy());
    const k = kachel("Cursor");
    fireEvent.click(k); fireEvent.click(k); fireEvent.click(k);
    await waitFor(() => expect(zeile("cursor")).toBeTruthy());
    expect(n).toBe(1);
    expect(posts("install").length).toBe(1);
  });

  it("bricht ab: stoppt den Vorgang, kehrt zur Auswahl zurück und lässt neu starten", async () => {
    let versuche = 0;
    schreib["POST"] = (_b, _q, t) => {
      if (letztes(t) === "install") { versuche++; cli("cursor", { state: "laeuft", busy: "install" }); }
      if (letztes(t) === "cancel") cli("cursor", { state: "fehlt", busy: null });
      return { ok: true };
    };
    render(<ModelleSchritt />);
    await waitFor(() => expect(kachel("Cursor")).toBeTruthy());
    fireEvent.click(kachel("Cursor"));
    fireEvent.click(await screen.findByText("Cancel"));
    await waitFor(() => expect(posts("cancel").length).toBe(1));
    await waitFor(() => expect(zeile("cursor")).toBeNull());
    await ereignis("cursor", "error", "Cancelled.");
    expect(screen.queryByText("Cancelled.")).toBeNull();
    fireEvent.click(kachel("Cursor"));
    await waitFor(() => expect(versuche).toBe(2));
  });

  it("zeigt den Fehlertext einer fehlgeschlagenen Installation und wiederholt", async () => {
    let versuch = 0;
    schreib["POST"] = (_b, _q, t) => { if (letztes(t) === "install") { versuch++; cli("cursor", { state: "laeuft", busy: "install" }); } return { ok: true }; };
    render(<ModelleSchritt />);
    await waitFor(() => expect(kachel("Cursor")).toBeTruthy());
    fireEvent.click(kachel("Cursor"));
    await waitFor(() => expect(versuch).toBe(1));
    cli("cursor", { state: "fehler", busy: null, message: "Installing Cursor failed." });
    await ereignis("cursor", "error", "Installing Cursor failed.");
    await warte("Installing Cursor failed.");
    expect(screen.getByRole("alert").textContent).toContain("failed");
    fireEvent.click(screen.getByText("Retry"));
    await waitFor(() => expect(versuch).toBe(2));
  });

  it("meldet mit Gerätecode an: öffnet die Adresse, zeigt den Code groß mit Kopieren und springt auf Verbunden", async () => {
    const schreibe = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText: schreibe }, configurable: true });
    schreib["POST"] = (_b, _q, t) => {
      if (letztes(t) !== "login") return { ok: true };
      cli("codex", { state: "laeuft", busy: "login", loginKind: "device-code", loginUrl: "https://auth.example.test/device", loginCode: "ABCD-1234" });
      return { ok: true, url: "https://auth.example.test/device", code: "ABCD-1234" };
    };
    render(<ModelleSchritt />);
    await waitFor(() => expect(kachel("Codex")).toBeTruthy());
    fireEvent.click(kachel("Codex"));
    await warte("ABCD-1234");
    expect(posts("login").length).toBe(1);
    expect(posts("install").length).toBe(0);
    expect(geoeffnet).toEqual(["https://auth.example.test/device"]);
    expect(screen.queryByLabelText("Paste the code from the browser")).toBeNull();
    fireEvent.click(screen.getByText("Copy"));
    await waitFor(() => expect(schreibe).toHaveBeenCalledWith("ABCD-1234"));
    fireEvent.click(screen.getByText("Open in browser"));
    expect(geoeffnet.length).toBe(2);
    cli("codex", { state: "bereit", busy: null, loggedIn: true, loginUrl: null, loginCode: null });
    await ereignis("codex", "done", "Codex is signed in.");
    await waitFor(() => expect(kachel("Codex").getAttribute("aria-checked")).toBe("true"));
    expect(screen.queryByText("ABCD-1234")).toBeNull();
    await waitFor(() => expect(zeile("codex")).toBeNull(), LANG);
  });

  const anmeldungLaeuft = async (art: string | null = "code-paste") => {
    schreib["POST"] = (_b, _q, t) => {
      if (letztes(t) !== "login") return { ok: true };
      cli("codex", { state: "laeuft", busy: "login", loginUrl: "https://auth.example.test/device", loginCode: null, ...(art ? { loginKind: art } : {}) });
      return { ok: true, url: "https://auth.example.test/device", code: null };
    };
    render(<ModelleSchritt />);
    await waitFor(() => expect(kachel("Codex")).toBeTruthy());
    fireEvent.click(kachel("Codex"));
    return screen.findByLabelText("Paste the code from the browser") as Promise<HTMLInputElement>;
  };

  it("schickt den Code aus dem Browser an den Dienst und zeigt den Warte-Hinweis", async () => {
    const feld = await anmeldungLaeuft();
    expect((screen.getByText("Send").closest("button") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(feld, { target: { value: " XYZ-123 " } });
    fireEvent.click(screen.getByText("Send"));
    await waitFor(() => expect(posts("login/input").length).toBe(1));
    expect(posts("login/input")[0].body).toEqual({ text: "XYZ-123" });
    // Das Feld weicht dem Warte-Hinweis, solange der Code geprüft wird.
    await screen.findByText("Checking code …");
    expect(screen.getByText(/This can take a moment/)).toBeTruthy();
    expect(screen.queryByLabelText("Paste the code from the browser")).toBeNull();
  });

  it("zeigt das Code-Feld auch ohne bekannte Anmelde-Art, aber nicht bei reinem Link", async () => {
    await anmeldungLaeuft(null);
    cleanup(); abbau(); start();
    const m = schreib; m["POST"] = (_b, _q, t) => { if (letztes(t) === "login") { cli("codex", { state: "laeuft", busy: "login", loginKind: "link" }); return { ok: true, url: "https://a.example.test/", code: null }; } return { ok: true }; };
    render(<ModelleSchritt />);
    await waitFor(() => expect(kachel("Codex")).toBeTruthy());
    fireEvent.click(kachel("Codex"));
    await screen.findByText("Open in browser");
    expect(screen.queryByLabelText("Paste the code from the browser")).toBeNull();
  });

  it("zeigt das Code-Feld nur, solange die Anmeldung läuft", async () => {
    render(<ModelleSchritt />);
    await waitFor(() => expect(kachel("Codex")).toBeTruthy());
    expect(screen.queryByLabelText("Paste the code from the browser")).toBeNull();
  });

  it("zeigt den Dienstfehler der Anmeldung (Antigravity hat keinen Anmeldebefehl) mit Wiederholen", async () => {
    schreib["POST"] = (_b, _q, t) => { if (letztes(t) === "login") throw "Antigravity has no separate sign-in command. Open Antigravity once and sign in there in the browser."; return { ok: true }; };
    render(<ModelleSchritt />);
    await waitFor(() => expect(kachel("Antigravity")).toBeTruthy());
    fireEvent.click(kachel("Antigravity"));
    await warte(/no separate sign-in command/);
    expect(screen.getByText("Retry")).toBeTruthy();
  });

  it("lässt nur eine Karte zur Zeit groß werden", async () => {
    schreib["POST"] = (_b, _q, t) => { if (letztes(t) === "install") cli("cursor", { state: "laeuft", busy: "install" }); return { ok: true }; };
    render(<ModelleSchritt />);
    await waitFor(() => expect(kachel("Cursor")).toBeTruthy());
    fireEvent.click(kachel("Cursor"));
    await waitFor(() => expect(zeile("cursor")).toBeTruthy());
    fireEvent.click(kachel("Codex"));
    expect(posts("login").length).toBe(0);
    expect(document.querySelectorAll("[data-karte]").length).toBe(1);
  });

  it("fängt einen fehlenden Anmelde-Link ab", async () => {
    schreib["POST"] = (_b, _q, t) => { if (letztes(t) === "login") { cli("codex", { state: "laeuft", busy: "login" }); return { ok: true, url: null, code: null }; } return { ok: true }; };
    render(<ModelleSchritt />);
    await waitFor(() => expect(kachel("Codex")).toBeTruthy());
    fireEvent.click(kachel("Codex"));
    await waitFor(() => expect(posts("login").length).toBe(1));
    await waitFor(() => expect(geoeffnet.length).toBe(0));
    expect(await screen.findByText("Cancel")).toBeTruthy();
  });

  it("kommt auch ohne Ereignis weiter, wenn die Liste „bereit“ meldet", async () => {
    schreib["POST"] = (_b, _q, t) => { if (letztes(t) === "login") { cli("codex", { state: "laeuft", busy: "login" }); return { ok: true, url: "https://a.example.test/", code: null }; } return { ok: true }; };
    render(<ModelleSchritt />);
    await waitFor(() => expect(kachel("Codex")).toBeTruthy());
    fireEvent.click(kachel("Codex"));
    await waitFor(() => expect(posts("login").length).toBe(1));
    cli("codex", { state: "bereit", busy: null, loggedIn: true });
    fireEvent.change(await screen.findByLabelText("Paste the code from the browser"), { target: { value: "X" } });
    fireEvent.click(screen.getByText("Send")); // Senden lädt die Liste neu
    await waitFor(() => expect(kachel("Codex").getAttribute("aria-checked")).toBe("true"));
  });
});

describe("Hilfsfunktionen", () => {
  const c = (p: object) => ({ id: "x", label: "X", installed: true, version: null, loggedIn: false, state: "bereit", ...p }) as any;
  it("erkennt Vorgang, Fehler, Schritt und Statustext", () => {
    expect(vorgangVon(c({ busy: "login", state: "laeuft" }), undefined)).toBe("login");
    expect(vorgangVon(c({ busy: true, state: "laeuft", message: "Installation in progress." }), undefined)).toBe("install");
    expect(vorgangVon(c({}), { aktion: "install" })).toBe("install");
    expect(vorgangVon(c({}), undefined)).toBeNull();
    expect(fehlerVon(c({ state: "fehler", message: "Kaputt." }), undefined, null)).toBe("Kaputt.");
    expect(fehlerVon(c({ state: "fehler", message: "Kaputt." }), undefined, "install")).toBeNull();
    expect(statusText(c({ state: "fehlt" }), null)).toBe("Not installed");
    expect(statusText(c({}), "login")).toBe("Waiting for sign-in …");
    expect(schrittVon(c({ installed: false, state: "fehlt" }), null)).toBe(0);
    expect(schrittVon(c({ state: "abgemeldet" }), "login")).toBe(1);
    expect(schrittVon(c({}), null)).toBe(2);
  });
});
