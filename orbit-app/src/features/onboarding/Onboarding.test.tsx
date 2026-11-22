import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Onboarding } from "./index";
import App from "../../App";
import { useOrbit } from "../../lib/store";
import { useNav } from "../../lib/nav";
import { activeCount } from "../../orbi/ticker";
import { mockDienst } from "./mock";
import { useErststart } from "./store";

let supabase: ReturnType<typeof mockDienst>["zustand"]["supabase"];
let abbau = () => {};
let log: { methode: string; pfad: string; body: unknown }[] = [];
beforeEach(() => {
  log = [];
  const m = mockDienst({ log });
  abbau = m.abbauen;
  supabase = m.zustand.supabase;
  useErststart.getState().zuruecksetzen();
});
afterEach(() => { cleanup(); abbau(); });

const warteAuf = async (text: string | RegExp) => waitFor(() => expect(screen.getByText(text)).toBeTruthy());

describe("Erststart", () => {
  it("zeigt Willkommen und führt zur Anmeldekarte", async () => {
    render(<Onboarding onDone={() => {}} />);
    await warteAuf("Welcome to Orbit");
    fireEvent.click(screen.getByText("Let’s go"));
    await screen.findByRole("heading", { name: "Orbit-Konto erstellen" });
  });

  it("übernimmt den Google-Namen und speichert den Avatar bei leerem Beruf", async () => {
    abbau();
    const m = mockDienst({ log });
    abbau = m.abbauen;
    m.zustand.profil.name = "";
    Object.assign(m.zustand.supabase, { signedIn: true, displayName: "Mira Kai" });
    useErststart.setState({ schritt: "name" });
    render(<Onboarding onDone={() => {}} />);
    await screen.findByDisplayValue("Mira Kai");
    await warteAuf("MK");
    const vorher = useErststart.getState().avatarFarbe;
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Lina" } });
    await warteAuf("L");
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Lina Braun" } });
    await warteAuf("LB");
    expect(useErststart.getState().avatarFarbe).toBe(vorher);
    fireEvent.click(screen.getByRole("button", { name: "Green" }));
    fireEvent.click(screen.getByRole("button", { name: "Serif" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(log.find((l) => l.methode === "PUT" && l.pfad === "/v1/settings/profile")?.body).toEqual({
      name: "Lina Braun", occupation: "", avatarColor: "gruen", avatarFont: "serifen",
    }));
  });

  it("öffnet eine Plugin-Karte und prüft genau den gestarteten Anmeldeversuch", async () => {
    useErststart.setState({ schritt: "plugins" });
    render(<Onboarding onDone={() => {}} />);
    const kachel = await screen.findByRole("checkbox", { name: /Drive/ });
    await waitFor(() => expect((kachel as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(kachel);
    await warteAuf("Connected.");
    expect(log.some((l) => l.methode === "POST" && l.pfad === "/v1/plugins/googledrive/connect")).toBe(true);
    expect(log.some((l) => l.pfad === "/v1/plugins/googledrive/status?accountId=ca_demo")).toBe(true);
    await waitFor(() => expect(kachel.getAttribute("aria-checked")).toBe("true"));
  });

  it("zeigt den Fehlertext des Dienstes am Namensfeld und behält Eingaben beim Zurückgehen", async () => {
    useErststart.setState({ schritt: "mac", orbiName: "" });
    render(<Onboarding onDone={() => {}} />);
    await warteAuf("What may Orbit do on your Mac?");
    fireEvent.click(screen.getByText("Continue"));
    await warteAuf("Your first Orbi");
    // Vorbelegung: Strobi in Pink hat einen eigenen Vorschlag; leert man das Feld, fehlt der Name.
    await waitFor(() => expect((screen.getByLabelText("Name") as HTMLInputElement).value).toMatch(/^\p{L}+$/u));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "" } });
    fireEvent.click(screen.getByText("Create Orbi"));
    await warteAuf("Give your Orbi a name");
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Mira" } });
    fireEvent.click(screen.getByLabelText("Back"));
    await warteAuf("What may Orbit do on your Mac?");
    fireEvent.click(screen.getByText("Continue"));
    await waitFor(() => expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Mira"));
  });

  it("legt den Orbi ohne look an, mit Figur und Farbe, und lädt die Orbis erst bei „Zur Übersicht“", async () => {
    let fertig = false;
    useErststart.setState({ schritt: "orbi", orbiName: "Mira", form: "grokbot", farbe: "blau" });
    render(<Onboarding onDone={() => { fertig = true; }} />);
    await warteAuf("Create Mira");
    fireEvent.click(screen.getByText("Create Mira"));
    await warteAuf("Mira is ready.");
    const post = log.find((l) => l.methode === "POST" && l.pfad === "/v1/bots");
    expect(post?.body).toMatchObject({ name: "Mira", avatar: "grokbot", color: "#3378ec", isMain: true, first: true });
    expect(post?.body).not.toHaveProperty("look");
    expect(log.some((l) => l.pfad === "/v1/bots" && l.methode === "GET")).toBe(false);
    expect(fertig).toBe(false);
    await act(async () => { fireEvent.click(screen.getByText("Go to overview")); });
    await waitFor(() => expect(fertig).toBe(true));
    expect(log.some((l) => l.pfad === "/v1/setup/profile/finish")).toBe(true);
  });

  it("bleibt mit geladenem Orbi auf Fertig und öffnet erst per Klick dessen Übersicht", async () => {
    supabase.signedIn = true;
    const orbit = useOrbit.getState();
    const nav = useNav.getState();
    useOrbit.setState({ bereit: true, bots: [], main: null, connect: async () => {} });
    useErststart.setState({ schritt: "fertig", orbiName: "Mira" });
    try {
      render(<App />);
      await screen.findByText("Go to overview");
      await act(async () => { await useOrbit.getState().loadBots(); });
      expect(useOrbit.getState().bots.length).toBeGreaterThan(0);
      expect(screen.getByText("Go to overview")).toBeTruthy();
      expect(document.querySelector("[data-hauptfenster]")).toBeNull();
      fireEvent.click(screen.getByText("Go to overview"));
      await waitFor(() => expect(document.querySelector("[data-hauptfenster]")).toBeTruthy());
      expect(useNav.getState().panel).toBe("uebersicht");
    } finally {
      cleanup(); useOrbit.setState(orbit, true); useNav.setState(nav, true);
    }
  });
});

describe("Namensvorschlag", () => {
  it("behält den Vorschlag bei Form und Farbe", async () => {
    useErststart.setState({ schritt: "orbi", orbiName: "", form: "strobi", farbe: "pink" });
    render(<Onboarding onDone={() => {}} />);
    const feld = () => screen.getByLabelText("Name") as HTMLInputElement;
    await waitFor(() => expect(feld().value).toMatch(/^\p{L}+$/u));
    const vorschlag = feld().value;
    fireEvent.click(screen.getByLabelText("Blue"));
    await waitFor(() => expect(feld().value).toBe(vorschlag));
    fireEvent.click(screen.getByLabelText("Cubee"));
    await waitFor(() => expect(feld().value).toBe(vorschlag));
    expect(screen.queryByText("Anderer Vorschlag")).toBeNull();
    fireEvent.change(feld(), { target: { value: "Mira" } });
    fireEvent.click(screen.getByLabelText("Red"));
    fireEvent.click(screen.getByLabelText("Nova"));
    await waitFor(() => expect(useErststart.getState().farbe).toBe("rot"));
    expect(feld().value).toBe("Mira");
  });
});

describe("Bühne (Bewegung)", () => {
  const mm = (reduce: boolean) => (q: string) => ({
    matches: reduce && q.includes("prefers-reduced-motion"), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false,
  });
  afterEach(() => { delete (window as { matchMedia?: unknown }).matchMedia; });

  it("läuft mit Zeitgeber und räumt beim Schließen auf", async () => {
    (window as unknown as { matchMedia: unknown }).matchMedia = mm(false);
    const { unmount } = render(<Onboarding onDone={() => {}} />);
    await warteAuf("Welcome to Orbit");
    expect(activeCount()).toBeGreaterThan(0);
    unmount();
    expect(activeCount()).toBe(0);
  });

  it("steht bei reduzierter Bewegung still: kein Zeitgeber, Orbis nur eingeblendet", async () => {
    (window as unknown as { matchMedia: unknown }).matchMedia = mm(true);
    render(<Onboarding onDone={() => {}} />);
    await warteAuf("Welcome to Orbit");
    expect(activeCount()).toBe(0);
    await waitFor(() => expect((document.querySelector('div[data-orbi="strobi"]') as HTMLElement).style.opacity).toBe("0.95"));
  });
});
