import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

vi.mock("../../lib/tauri", () => ({ openUrl: async () => {}, serviceConnect: async () => ({}), apiRequest: async () => ({}), apiStream: () => ({ done: Promise.resolve(), cancel: async () => {} }) }));

import { arbeiter, baueVerlauf, chatListe, chatPunkt, farbeVonHex, fragenVon, initialen, kurzbefehl, liveText, mischeKarten, sendeTaste, zeitLabel } from "./logik";
import { Markdown, parseInline, parseMarkdown } from "./markdown";
import type { Bot, Karte, Nachricht } from "../../lib/types";

const bot = (id: string, main = false, last: string | null = null): Bot => ({ chatId: `c-${id}`, id, name: id, avatar: "strobi", color: null, job: "", instructions: "", isMain: main, onboardingDone: true, look: null, lastMessageAt: last });
const karte = (o: Partial<Karte>): Karte => ({ id: "k", kind: "approval", chatId: "c-a", botId: "a", toolCallId: "t", tool: "x", input: {}, requestedAt: "2026-01-01T10:00:00Z", expiresAt: "", runId: "r", ...o });

describe("Chatliste und Punkte", () => {
  it("Hauptorbi als Kachel, Rest nach letzter Nachricht", () => {
    const l = chatListe([bot("m", true), bot("a"), bot("b")], [{ id: "g", name: "G", members: [] }], [
      { id: "c-a", lastMessageAt: "2026-01-01T10:00:00Z", memberCount: 2 },
      { id: "c-b", lastMessageAt: "2026-01-02T10:00:00Z", memberCount: 2 },
      { id: "g", lastMessageAt: "2026-01-03T10:00:00Z", memberCount: 3 },
    ], null);
    expect(l.haupt?.id).toBe("m");
    expect(l.eintraege.map((e) => e.name)).toEqual(["G", "b", "a"]);
  });
  it("Orange vor Blau", () => {
    const w = { "c-a:a": { chatId: "c-a", botId: "a", status: "wartet" as const } };
    expect(chatPunkt("c-a", { "c-a": 2 }, [], w)).toBe("braucht-dich");
    expect(chatPunkt("c-a", { "c-a": 2 }, [], {})).toBe("fertig");
    expect(chatPunkt("c-a", {}, [karte({})], {})).toBe("braucht-dich");
    expect(chatPunkt("c-b", {}, [karte({})], {})).toBeNull();
    expect(arbeiter("c-a", w)).toHaveLength(1);
  });
  it("Farbe, Live-Text, Initialen", () => {
    expect(farbeVonHex("#de3a8e")).toBe("pink");
    expect(farbeVonHex("#4f5ae0")).toBe("indigo");
    expect(farbeVonHex(null)).toBe("pink");
    expect(liveText("Mira", "arbeitet", "liest deinen Kalender")).toBe("Mira is working · liest deinen Kalender");
    expect(liveText("Mira", "wartet", "deinen Login")).toBe("Mira is waiting for deinen Login");
    expect(initialen("Constantin Holzborn")).toBe("CH");
  });
});

describe("Verlauf", () => {
  const T = new Date(2026, 0, 5, 10, 41).getTime();
  const msgs: Nachricht[] = [
    { id: "1", role: "user", parts: [{ type: "text", text: "Hi" }], metadata: { createdAt: T } },
    { id: "2", role: "assistant", parts: [{ type: "text", text: "A" }, { type: "text", text: "B" }], metadata: { botId: "n", createdAt: T + 1000 } },
    { id: "3", role: "assistant", parts: [{ type: "text", text: "C" }, { type: "tool-automation_create", toolCallId: "x", state: "output-available", input: { name: "Plan" } }, { type: "tool-memory_save", toolCallId: "y", state: "output-available" }], metadata: { botId: "l", createdAt: T + 2000 } },
  ];
  it("Zeitmarke, einzelne Nachrichten, Absender in Gruppen und versteckte Werkzeuge", () => {
    const v = baueVerlauf(msgs, { gruppe: true, jetzt: T });
    expect(v.map((e) => e.t)).toEqual(["zeit", "ich", "orbi", "orbi", "orbi", "system"]);
    expect((v[0] as any).label).toBe("Today, 10:41");
    expect(v.slice(2, 5).map((e) => e.key)).toEqual(["2~t0", "2~t1", "3~t0"]);
    expect((v[2] as any).absender).toBe(true);
    expect((v[3] as any).absender).toBe(false);
    expect((v[5] as any).text).toBe("Created: routine");
    expect(baueVerlauf(msgs, { gruppe: false }).filter((e) => e.t === "orbi")).toHaveLength(3);
  });
  it("Termine angelegt: Ergebnis-Karte mit Zahlwort", () => {
    const m: Nachricht[] = [{ id: "e", role: "assistant", parts: [{ type: "tool-apple_calendar_create_many", toolCallId: "c", state: "output-available", input: { events: [{}, {}, {}] }, output: { ok: true, created: 3 } }], metadata: { botId: "n", createdAt: T } } as Nachricht];
    const k = baueVerlauf(m, { gruppe: true, jetzt: T }).find((e) => e.t === "ergebnis") as any;
    expect(k.titel).toBe("Three events added");
    expect(k.untertitel).toBe("Apple Calendar");
  });
  it("Karten zeitlich einordnen", () => {
    const v = baueVerlauf(msgs, { gruppe: false });
    const m = mischeKarten(v, [karte({ requestedAt: new Date(T + 500).toISOString() })]);
    expect(m.findIndex((e) => e.t === "karte")).toBeLessThan(m.findIndex((e) => e.t === "orbi"));
    expect(mischeKarten(v, [karte({ requestedAt: "x" })]).slice(-1)[0].t).toBe("karte");
  });
  it("Zeitlabel und Fragen", () => {
    expect(zeitLabel(T - 86_400_000, T)).toMatch(/^Yesterday/);
    expect(fragenVon({ questions: [{ question: "Q", options: [{ label: "A" }] }] })[0].options[0].label).toBe("A");
  });
});

describe("Tastatur", () => {
  it("Enter sendet, Shift+Enter und Komposition nicht", () => {
    expect(sendeTaste({ key: "Enter", shiftKey: false })).toBe(true);
    expect(sendeTaste({ key: "Enter", shiftKey: true })).toBe(false);
    expect(sendeTaste({ key: "Enter", shiftKey: false, isComposing: true })).toBe(false);
  });
  it("Kurzbefehle", () => {
    const e = (key: string) => ({ key, metaKey: true, ctrlKey: false, shiftKey: false, altKey: false });
    expect(kurzbefehl(e(","))).toBe("einstellungen");
    expect(kurzbefehl(e("n"))).toBe("neu");
    expect(kurzbefehl(e("b"))).toBe("seitenleiste");
    expect(kurzbefehl({ ...e("n"), metaKey: false })).toBeNull();
  });
});

describe("Markdown", () => {
  it("Blöcke und Inline", () => {
    const b = parseMarkdown("# T\n\ntext **fett** und `c`\n\n- a\n- b\n\n```js\nx\n```");
    expect(b.map((x) => x.t)).toEqual(["h", "p", "list", "code"]);
    expect(parseInline("snake_case_name")).toEqual([{ t: "text", s: "snake_case_name" }]);
    expect(parseInline("*k*")[0].t).toBe("i");
    expect(parseInline("[x](javascript:alert(1))").every((n) => n.t !== "a")).toBe(true);
  });
  it("Rendert ohne HTML-Einschleusung und mit offenem Codezaun", () => {
    const { container } = render(<Markdown text={"<img src=x onerror=1> **a**\n\n```\noffen"} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("strong")?.textContent).toBe("a");
    expect(container.querySelector("pre")?.textContent).toBe("offen");
  });
});
