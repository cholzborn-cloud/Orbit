import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Onboarding } from "./index";
import { CodeSchritt } from "./schritte";
import { mockDienst } from "./mock";
import { useErststart } from "./store";

let m: ReturnType<typeof mockDienst>;
beforeEach(() => {
  localStorage.clear();
  m = mockDienst();
  useErststart.getState().zuruecksetzen();
  useErststart.setState({ schritt: "start", szene: "start" });
});
afterEach(() => { cleanup(); m.abbauen(); });

describe("Konto-Schritt (Supabase)", () => {
  it("meldet mit E-Mail an, verlangt Code und geht zum Namen weiter", async () => {
    render(<Onboarding onDone={() => {}} />);
    await screen.findByRole("heading", { name: "Orbit-Konto erstellen" });
    fireEvent.change(screen.getByLabelText("E-Mail"), { target: { value: "a@b.de" } });
    fireEvent.change(screen.getByLabelText("Passwort"), { target: { value: "geheim12" } });
    fireEvent.click(screen.getByRole("button", { name: "Konto erstellen" }));
    await screen.findByRole("heading", { name: "E-Mail bestätigen" });
    expect(useErststart.getState().schritt).toBe("code");
    expect((screen.getByRole("button", { name: /Neuer Code in/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Code aus der E-Mail"), { target: { value: "123 456" } });
    fireEvent.click(screen.getByRole("button", { name: "E-Mail bestätigen" }));
    await waitFor(() => expect(useErststart.getState().schritt).toBe("name"));
    expect(localStorage.getItem("orbit.letzteAnmeldung")).toBe("email");
  });

  it("erlaubt nach genau 60 Sekunden eine neue Code-Mail und startet die Frist erneut", async () => {
    vi.useFakeTimers();
    try {
      useErststart.setState({ email: "TEST@example.com", mailSperren: { "test@example.com": Date.now() + 60_000 } });
      render(<CodeSchritt />);
      expect((screen.getByRole("button", { name: "Neuer Code in 60 s" }) as HTMLButtonElement).disabled).toBe(true);
      act(() => vi.advanceTimersByTime(59_000));
      expect((screen.getByRole("button", { name: "Neuer Code in 1 s" }) as HTMLButtonElement).disabled).toBe(true);
      act(() => vi.advanceTimersByTime(1000));
      const erneut = screen.getByRole("button", { name: "Code erneut anfordern" }) as HTMLButtonElement;
      expect(erneut.disabled).toBe(false);
      await act(async () => { fireEvent.click(erneut); });
      expect((screen.getByRole("button", { name: "Neuer Code in 60 s" }) as HTMLButtonElement).disabled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("zeigt den deutschen Fehlertext und bleibt auf der Karte", async () => {
    render(<Onboarding onDone={() => {}} />);
    await screen.findByRole("heading", { name: "Orbit-Konto erstellen" });
    fireEvent.click(screen.getByRole("button", { name: "Konto erstellen" }));
    await screen.findByText("E-Mail und Passwort eingeben.");
    expect(useErststart.getState().schritt).toBe("start");
  });

  it("Google: wartet auf den Browser, lässt sich abbrechen ohne Fehlertext, danach erneut möglich", async () => {
    render(<Onboarding onDone={() => {}} />);
    fireEvent.click(await screen.findByText("Mit Google fortfahren"));
    await screen.findByRole("heading", { name: "Im Browser fortfahren" });
    fireEvent.click(screen.getByText("Abbrechen"));
    await screen.findByText("Mit Google fortfahren");
    expect(screen.queryByText("Die Anmeldung wurde abgebrochen.")).toBeNull();
    fireEvent.click(screen.getByText("Mit Google fortfahren"));
    await screen.findByRole("heading", { name: "Im Browser fortfahren" });
    await act(async () => { m.zustand.supabase.fertig?.(); });
    await waitFor(() => expect(useErststart.getState().schritt).toBe("name"));
    expect(localStorage.getItem("orbit.letzteAnmeldung")).toBe("google");
  });

  it("wechselt bei bereits registrierter E-Mail zur Anmeldung und leert das Passwort", async () => {
    m.zustand.supabase.signupFehler = { code: "email_exists", message: "Schon registriert." };
    localStorage.setItem("orbit.letzteAnmeldung", "google");
    render(<Onboarding onDone={() => {}} />);
    await screen.findByText("Zuletzt genutzt");
    fireEvent.change(screen.getByLabelText("E-Mail"), { target: { value: "a@b.de" } });
    fireEvent.change(screen.getByLabelText("Passwort"), { target: { value: "geheim12" } });
    fireEvent.click(screen.getByRole("button", { name: "Konto erstellen" }));
    await screen.findByRole("button", { name: "Anmelden" });
    expect(screen.getByDisplayValue("a@b.de")).toBeTruthy();
    expect((screen.getByLabelText("Passwort") as HTMLInputElement).value).toBe("");
    expect(localStorage.getItem("orbit.letzteAnmeldung")).toBe("google");
  });

  it("bleibt beim vorhandenen Konto, wenn der Google-Provider eine Kollision meldet", async () => {
    m.zustand.supabase.googleFehler = { code: "google_conflict", message: "Kollision", email: "a@b.de" };
    render(<Onboarding onDone={() => {}} />);
    fireEvent.click(await screen.findByText("Mit Google fortfahren"));
    await act(async () => { m.zustand.supabase.fertig?.(); });
    await screen.findByRole("button", { name: "Anmelden" });
    expect(screen.getByDisplayValue("a@b.de")).toBeTruthy();
    expect(useErststart.getState().schritt).toBe("start");
    expect(localStorage.getItem("orbit.letzteAnmeldung")).toBeNull();
  });
  it("ohne Supabase-Einrichtung: Hinweis und „Ohne Konto fortfahren“ geht weiter", async () => {
    m.zustand.supabase.configured = false;
    render(<Onboarding onDone={() => {}} />);
    await screen.findByText(/Die Anmeldung ist in dieser App-Version nicht verfügbar/);
    fireEvent.click(screen.getByText("Ohne Konto fortfahren"));
    await waitFor(() => expect(useErststart.getState().schritt).toBe("name"));
  });

  it("Passwort lässt sich mit dem Code in Orbit zurücksetzen", async () => {
    render(<Onboarding onDone={() => {}} />);
    fireEvent.click(await screen.findByRole("tab", { name: "Anmelden" }));
    fireEvent.click(screen.getByText("Passwort vergessen?"));
    expect(screen.getByRole("heading", { name: "Passwort vergessen?" })).toBeTruthy();
    expect(screen.queryByLabelText("Passwort")).toBeNull();
    fireEvent.change(screen.getByLabelText("E-Mail"), { target: { value: "a@b.de" } });
    fireEvent.click(screen.getByText("Code anfordern"));
    fireEvent.change(await screen.findByLabelText("Code aus der E-Mail"), { target: { value: "123 456" } });
    expect((screen.getByRole("button", { name: /Neuer Code in/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Neues Passwort"), { target: { value: "test-only-password" } });
    fireEvent.click(screen.getByText("Passwort speichern"));
    await screen.findByRole("heading", { name: "Passwort geändert" });
    fireEvent.click(screen.getByText("Zurück zur Anmeldung"));
    const anmelden = await screen.findByRole("button", { name: "Anmelden" }) as HTMLButtonElement;
    expect(anmelden.disabled).toBe(false);
    fireEvent.change(screen.getByLabelText("Passwort"), { target: { value: "test-only-password" } });
    fireEvent.click(anmelden);
    await screen.findByLabelText("Code aus der E-Mail");
    expect((screen.getByRole("button", { name: /Neuer Code in/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
