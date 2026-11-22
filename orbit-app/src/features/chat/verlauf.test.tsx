import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useOrbit } from "../../lib/store";
import { applyChunk } from "../../lib/chunks";
import type { Nachricht, Reaktion } from "../../lib/types";
import { Verlauf } from "./verlauf";

// jsdom hat kein Layout: Höhe, Sichthöhe und Scrollstand werden hier nachgebildet, der ResizeObserver von Hand ausgelöst.
const CLIENT = 400;
let hoehe = 1000;
let beobachter: (() => void)[] = [];

beforeEach(() => {
  hoehe = 1000;
  beobachter = [];
  vi.stubGlobal("ResizeObserver", class { constructor(cb: () => void) { beobachter.push(cb); } observe() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); useOrbit.setState({ messages: {} }); });

const text = (id: string, role: Nachricht["role"], t: string, metadata?: Nachricht["metadata"]): Nachricht => ({ id, role, parts: [{ type: "text", text: t, state: "done" }], metadata });
const setze = (messages: Nachricht[]) => act(() => { useOrbit.setState({ messages: { c1: messages } }); });
const waechst = (zu: number) => act(() => { hoehe = zu; beobachter.forEach((cb) => cb()); }); // neue Zeilen oder Streaming-Text machen den Inhalt höher

function zeigen() {
  setze([text("m1", "assistant", "Hallo")]);
  const { container } = render(<Verlauf chatId="c1" gruppe={false} bot={null} mitglieder={[]} farbe="pink" onErneut={() => {}} />);
  const el = container.querySelector<HTMLElement>("[data-verlauf]")!;
  let top = 0;
  Object.defineProperty(el, "scrollHeight", { get: () => hoehe });
  Object.defineProperty(el, "clientHeight", { get: () => CLIENT });
  Object.defineProperty(el, "scrollTop", { get: () => top, set: (v: number) => { top = Math.min(v, hoehe - CLIENT); }, configurable: true });
  const scrollen = (zu: number) => act(() => { top = zu; el.dispatchEvent(new Event("scroll")); }); // so scrollt der Nutzer
  waechst(hoehe); // einmal anlegen: klebt unten
  return { el, scrollen, unten: () => el.scrollTop === hoehe - CLIENT };
}

it("läuft bei neuen Nachrichten und beim Streaming mit nach unten", () => {
  const v = zeigen();
  expect(v.unten()).toBe(true);
  waechst(1300); // Streaming: Text wird länger
  expect(v.unten()).toBe(true);
  waechst(1700);
  expect(v.unten()).toBe(true);
});

it("stoppt, sobald man selbst nach oben scrollt, und läuft ab ganz unten (mit kleinem Spielraum) wieder mit", () => {
  const v = zeigen();
  v.scrollen(200); // nach oben gelesen
  waechst(1500);
  expect(v.el.scrollTop).toBe(200); // kein Mitlaufen
  waechst(1800);
  expect(v.el.scrollTop).toBe(200);
  v.scrollen(1800 - CLIENT - 40); // fast unten (innerhalb von 80 px) zählt als unten
  waechst(2000);
  expect(v.unten()).toBe(true);
});

it("springt bei der eigenen gesendeten Nachricht immer nach unten, auch wenn man oben liest", () => {
  const v = zeigen();
  v.scrollen(100);
  hoehe = 1400;
  setze([text("m1", "assistant", "Hallo"), text("u1", "user", "Frage", { pending: true })]);
  expect(v.unten()).toBe(true);
  waechst(1800); // und läuft danach wieder mit
  expect(v.unten()).toBe(true);
});

it("eine neue Antwort eines anderen reißt einen nach oben scrollenden Leser nicht nach unten", () => {
  const v = zeigen();
  v.scrollen(100);
  hoehe = 1400;
  setze([text("m1", "assistant", "Hallo"), text("a2", "assistant", "Neu")]);
  waechst(1400);
  expect(v.el.scrollTop).toBe(100);
});

const chatId = "test-verlauf";
const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==";
const nachricht = (id: string, text: string): Nachricht => ({ id, role: "assistant", parts: [{ type: "text", text }] });

function zeige(messages: Nachricht[], reaktionen: Reaktion[] = []) {
  const react = vi.fn(async (_chat: string, id: string, emoji: string | null) => {
    useOrbit.setState((s) => {
      const liste = (s.reactions[chatId] ?? []).filter((r) => r.messageId !== id || r.actor !== "user");
      if (emoji) liste.push({ messageId: id, actor: "user", emoji });
      return { reactions: { ...s.reactions, [chatId]: liste } };
    });
  });
  const antwort = vi.fn();
  useOrbit.setState({ messages: { [chatId]: messages }, reactions: { [chatId]: reaktionen }, react });
  render(<Verlauf chatId={chatId} gruppe={false} bot={null} mitglieder={[]} farbe="blau" onErneut={() => {}} onAntwort={antwort} />);
  return { react, antwort };
}

describe("Nachrichtenaktionen", () => {
  it("hat kein Hover-Menü und hält eine Reaktion am ersten Textteil während ein zweiter Teil wächst", () => {
    let m = applyChunk(null, { type: "start", messageId: "live" })!;
    m = applyChunk(m, { type: "text-delta", id: "live~t0", delta: "Erste Blase" })!;
    m = applyChunk(m, { type: "text-end", id: "live~t0" })!;
    const { react } = zeige([m]);
    const erste = screen.getByText("Erste Blase").closest("[data-nachricht]")!;
    fireEvent.mouseOver(erste);
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.contextMenu(erste);
    const schnell = screen.getByRole("group", { name: "Quick reactions" });
    const plus = within(schnell).getByRole("button", { name: "All emojis" });
    fireEvent.click(within(schnell).getByRole("button", { name: "Thumbs up" }));
    expect(react).toHaveBeenCalledWith(chatId, "live~t0", "👍");
    fireEvent.contextMenu(erste);
    fireEvent.click(screen.getByRole("button", { name: "All emojis" }));
    const menue = screen.getByRole("group", { name: "Message menu" });
    expect(plus.isConnected).toBe(false);
    expect(within(menue).getByRole("button", { name: "All emojis" }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.change(within(menue).getByRole("searchbox"), { target: { value: "flag: germany" } });
    fireEvent.click(screen.getByRole("button", { name: /🇩🇪/ }));
    expect(react).toHaveBeenCalledWith(chatId, "live~t0", "🇩🇪");
    act(() => {
      m = applyChunk(m, { type: "text-delta", id: "live~t1", delta: "Zweite Blase" })!;
      useOrbit.setState({ messages: { [chatId]: [m] } });
    });
    const zweite = screen.getByText("Zweite Blase").closest("[data-nachricht]")!;
    expect(erste.parentElement?.querySelector("[data-reaktionen]")?.textContent).toBe("🇩🇪");
    expect(zweite.parentElement?.querySelector("[data-reaktionen]")).toBeNull();
    expect(zweite.querySelector(".chat-cursor")).not.toBeNull();
  });

  it("entfernt über das Emoji nur die eigene Reaktion, auch bei älteren Reaktionen", () => {
    const { react } = zeige([nachricht("a", "Eine Nachricht")], [
      { messageId: "a", actor: "user", emoji: "👍" },
      { messageId: "a~t0", actor: "orbi", emoji: "👍" },
    ]);
    const blase = screen.getByText("Eine Nachricht").closest("[data-nachricht]")!;
    fireEvent.contextMenu(blase);
    expect(screen.queryByRole("menuitem", { name: "Remove reaction" })).toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });

    fireEvent.click(screen.getByRole("button", { name: /👍 · 2 reactions/ }));
    expect(react).toHaveBeenCalledWith(chatId, "a", null);
    expect(screen.queryByRole("button", { name: /Remove your reaction/ })).toBeNull();
    expect(blase.parentElement?.querySelector("[data-reaktionen]")?.textContent).toBe("👍");
  });

  it("öffnet Bilder und wendet Antworten, Kopieren und Info auf die angeklickte Nachricht an", () => {
    const copy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: copy } });
    const mitDatei: Nachricht = { id: "gif", role: "assistant", parts: [{ type: "file", mediaType: "image/png", filename: "Testbild.png", url: png }] };
    const zweiteNachricht = { ...nachricht("b", "Zwei"), metadata: { model: "Luna 6", inputTokens: 12345, outputTokens: 87, cachedTokens: 400 } };
    const { antwort } = zeige([nachricht("a", "Eins"), zweiteNachricht, mitDatei]);
    fireEvent.click(screen.getByRole("button", { name: /Testbild.png · Open preview/ }));
    const dialog = screen.getByRole("dialog", { name: "Testbild.png" });
    expect(within(dialog).getByRole("img").getAttribute("src")).toBe(png);
    fireEvent.keyDown(dialog, { key: "Escape" });
    const zweite = screen.getByText("Zwei").closest("[data-nachricht]")!;
    fireEvent.click(zweite);
    expect(screen.queryByRole("menuitem", { name: "Reply" })).toBeNull();
    expect(zweite.className).not.toContain("chat-nachricht-ausgewaehlt");
    fireEvent.contextMenu(zweite);
    fireEvent.click(screen.getByRole("menuitem", { name: "Reply" }));
    expect(antwort).toHaveBeenCalledWith({ id: "b~t0", name: "Orbi", text: "Zwei" });
    fireEvent.contextMenu(zweite);
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy" }));
    expect(copy).toHaveBeenCalledWith("Zwei");
    fireEvent.contextMenu(zweite);
    fireEvent.click(screen.getByRole("menuitem", { name: "Info" }));
    const info = within(screen.getByRole("dialog", { name: "Message info" }));
    expect(info.getByText("Luna 6")).toBeTruthy();
    expect(info.getByText("12.345 input")).toBeTruthy();
    expect(info.getByText("87 output")).toBeTruthy();
    expect(info.getByText("400 from cache")).toBeTruthy();
  });

  it("bietet bei eigenen Nachrichten keine Info an und öffnet Menü nur per Rechtsklick", () => {
    zeige([{ id: "u1", role: "user", parts: [{ type: "text", text: "Von mir" }] }]);
    const blase = screen.getByText("Von mir").closest("[data-nachricht]")!;
    fireEvent.click(blase);
    expect(screen.queryByRole("menuitem", { name: "Reply" })).toBeNull();
    fireEvent.contextMenu(blase);
    expect(blase.className).not.toContain("chat-nachricht-ausgewaehlt");
    expect(screen.getByRole("menuitem", { name: "Reply" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Copy" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Info" })).toBeNull();
  });
});
