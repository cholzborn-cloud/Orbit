import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  Auswahl, Blase, Feld, Gallery, Gruppe, Kachel, Karte, Knopf, Ladeanzeige, Medienkarte,
  Menue, Menuetrenner, Menuezeile, Schalter, Symbol, SYMBOL_NAMEN, Zeile,
} from "./index";

describe("ui", () => {
  it("Ladeanzeige erscheint erst bei einer länger laufenden Abfrage", () => {
    vi.useFakeTimers();
    try {
      const { unmount } = render(<Ladeanzeige text="Chat wird geladen …" />);
      act(() => { vi.advanceTimersByTime(149); });
      expect(screen.queryByRole("status")).toBeNull();
      act(() => { vi.advanceTimersByTime(1); });
      expect(screen.getByRole("status").textContent).toBe("Chat wird geladen …");
      unmount();
      expect(screen.queryByRole("status")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
  it("Symbol: zeichnet dünne Linie, dekorativ ohne Titel", () => {
    const { container } = render(<Symbol name="plus" />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("width")).toBe("16");
    expect(svg.getAttribute("stroke")).toBe("currentColor");
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.innerHTML.length).toBeGreaterThan(10);
    expect(SYMBOL_NAMEN.length).toBeGreaterThanOrEqual(58);
  });
  it("Symbol: Marke", () => {
    const { container } = render(<Symbol marke="slack" titel="Slack" />);
    expect(container.querySelector("svg")!.getAttribute("aria-label")).toBe("Slack");
  });
  it("Knopf: Klick, Deaktiviert", () => {
    const f = vi.fn();
    render(<><Knopf onClick={f}>Los</Knopf><Knopf disabled art="gefahr">Aus</Knopf></>);
    fireEvent.click(screen.getByText("Los"));
    expect(f).toHaveBeenCalledOnce();
    expect((screen.getByText("Aus") as HTMLButtonElement).disabled).toBe(true);
  });
  it("Schalter: wechselt", () => {
    const f = vi.fn();
    render(<Schalter aria-label="x" checked={false} onChange={f} />);
    const s = screen.getByRole("switch");
    expect(s.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(s);
    expect(f).toHaveBeenCalledWith(true);
  });
  it("Auswahl: meldet Wert", () => {
    const f = vi.fn();
    render(<Auswahl aria-label="m" optionen={[{ wert: "a", text: "A" }, { wert: "b", text: "B" }]} onChange={f} />);
    fireEvent.change(screen.getByLabelText("m"), { target: { value: "b" } });
    expect(f).toHaveBeenCalledWith("b");
  });
  it("Feld: Label, Fehler", () => {
    render(<Feld label="Name" fehler="Zu lang" />);
    const i = screen.getByLabelText("Name");
    expect(i.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("Zu lang")).toBeTruthy();
  });
  it("Menüzeile und Menü", () => {
    const f = vi.fn();
    render(<Menue><Menuezeile text="Kopieren" rechts="⌘C" onClick={f} /><Menuetrenner /><Menuezeile text="Löschen" art="gefahr" /></Menue>);
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitem", { name: /Kopieren/ }));
    expect(f).toHaveBeenCalled();
    expect(screen.getAllByRole("menuitem").length).toBe(2);
  });
  it("Blase: Varianten", () => {
    const { container } = render(<><Blase>Hallo</Blase><Blase von="ich" farbe="blau">Ich</Blase><Blase von="gruppe">G</Blase></>);
    expect(container.querySelectorAll("[data-von]").length).toBe(3);
    expect((screen.getByText("Ich") as HTMLElement).style.backgroundColor).toContain("--orbit-blase-blau");
  });
  it("Karte: vier Arten", () => {
    const f = vi.fn();
    const { container } = render(
      <>
        <Karte art="freigabe" text="Allow?" onErlauben={f} />
        <Karte art="frage" titel="Frage" antworten={["Eins", "Zwei"]} />
        <Karte art="status" titel="Fertig" statusText="Erledigt" />
        <Karte art="fehler" titel="Fehler" aktionText="Nochmal" />
      </>,
    );
    fireEvent.click(screen.getByText("Allow"));
    expect(f).toHaveBeenCalled();
    for (const a of ["freigabe", "frage", "status", "fehler"]) expect(container.querySelector(`[data-art="${a}"]`)).toBeTruthy();
  });
  it("Zeile: Titel, Klick", () => {
    const f = vi.fn();
    render(<Zeile titel="Titel" beschreibung="Text" onClick={f} />);
    fireEvent.click(screen.getByRole("button"));
    expect(f).toHaveBeenCalled();
    expect(screen.getByText("Text")).toBeTruthy();
  });
  it("Gruppe: Überschrift und Zeilen", () => {
    render(<Gruppe titel="Gruppe"><Zeile titel="A" /><Zeile titel="B" /></Gruppe>);
    expect(screen.getByText("Gruppe")).toBeTruthy();
    expect(screen.getByText("B")).toBeTruthy();
  });
  it("Kachel: Titel, Aktion", () => {
    render(<Kachel marke="slack" titel="Slack" aktion={<Knopf groesse="klein">Verbinden</Knopf>} ausgewaehlt />);
    expect(screen.getByText("Slack")).toBeTruthy();
    expect(screen.getByText("Verbinden")).toBeTruthy();
  });
  it("Medienkarte: Titel, Bild", () => {
    const { container } = render(<Medienkarte titel="Plan.pdf" bild="x.png" quelle={{ symbol: "file", text: "Dateien" }} />);
    expect(screen.getByText("Plan.pdf")).toBeTruthy();
    expect(container.querySelector("img")).toBeTruthy();
  });
  it("Gallery: rendert Hell und Dunkel", () => {
    const { container } = render(<Gallery />);
    expect(container.querySelector('[data-theme="light"]')).toBeTruthy();
    expect(container.querySelector('[data-theme="dark"]')).toBeTruthy();
  });
});
