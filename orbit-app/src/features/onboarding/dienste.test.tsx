import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DiensteEinstellungen } from "../einstellungen/dienste";
import { DiensteSchritt } from "./schritte";
import { mockDienst } from "./mock";
import { useErststart } from "./store";

let m: ReturnType<typeof mockDienst>;
beforeEach(() => {
  localStorage.clear();
  m = mockDienst();
  useErststart.getState().zuruecksetzen();
  useErststart.setState({ schritt: "dienste" });
});
afterEach(() => { cleanup(); m.abbauen(); });

describe("Dienste-Schritt (Daytona + Jev)", () => {
  it("zeigt optionale Dienste mit geschlossenen Feldern und lässt sie überspringen", async () => {
    render(<DiensteSchritt />);
    expect(await screen.findByRole("heading", { name: /Cloud computer/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add key for Daytona" }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByLabelText("Jev key")).toBeNull();
    expect(screen.queryByRole("switch")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));
    await waitFor(() => expect(useErststart.getState().schritt).toBe("plugins"));
  });

  it("öffnet einen Editor, verwirft geschlossene Entwürfe und zeigt den gespeicherten Status", async () => {
    render(<DiensteSchritt />);
    const daytona = await screen.findByRole("button", { name: "Add key for Daytona" });
    await waitFor(() => expect((daytona as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(daytona);
    fireEvent.change(screen.getByLabelText("Daytona key"), { target: { value: "dtn_test_secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Add key for Jev" }));
    expect(screen.queryByLabelText("Daytona key")).toBeNull();
    fireEvent.click(daytona);
    const feld = screen.getByLabelText("Daytona key") as HTMLInputElement;
    expect(feld.value).toBe("");
    fireEvent.change(feld, { target: { value: "dtn_test_secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Save key" }));
    await screen.findByRole("button", { name: "Key saved for Daytona" });
    expect(m.zustand.keys.daytona).toBe(true);
    expect(screen.queryByLabelText("Replace Daytona key")).toBeNull();
    expect(screen.getByRole("button", { name: "Continue" })).toBeTruthy();
  });

  it("schaltet Jev in den Einstellungen um und bewahrt das Tagesbudget", async () => {
    render(<DiensteEinstellungen />);
    const details = screen.getByText("Auto settings").closest("details")!;
    expect(details.open).toBe(false);
    details.open = true;
    const schalter = await screen.findByRole("switch", { name: "Jev chooses the model" });
    expect(schalter.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(schalter);
    await waitFor(() => expect(m.zustand.jevAuto).toBe(false));
    const budget = screen.getByLabelText("Daily Jev budget");
    await waitFor(() => expect((budget as HTMLSelectElement).disabled).toBe(false));
    fireEvent.change(budget, { target: { value: "2" } });
    await waitFor(() => expect(m.zustand.budget.jevDailyUsd).toBe(2));
  });
});
