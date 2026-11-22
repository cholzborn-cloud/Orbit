import { beforeEach, describe, expect, it, vi } from "vitest";

interface FakeStream { method: string; path: string; body: any; onEvent: (e: any) => void; resolve: () => void; reject: (e: any) => void; cancelled: boolean }
const streams: FakeStream[] = [];
const requests: { method: string; path: string; body: any }[] = [];
let handlers: Record<string, (body: any) => any> = {};
let connectImpl: () => Promise<any> = async () => ({ port: 1, dataDir: "x" });

vi.mock("./tauri", () => ({
  serviceConnect: () => connectImpl(),
  apiRequest: async (method: string, path: string, body?: any) => {
    requests.push({ method, path, body });
    const key = `${method} ${path.split("?")[0]}`;
    const h = handlers[key];
    if (!h) return { ok: true };
    return h(body);
  },
  apiStream: (method: string, path: string, body: any, onEvent: (e: any) => void) => {
    const s = { method, path, body, onEvent, cancelled: false } as FakeStream;
    const done = new Promise<void>((res, rej) => { s.resolve = res; s.reject = rej; });
    streams.push(s);
    return { done, cancel: async () => { s.cancelled = true; s.resolve(); } };
  },
  openUrl: async () => {},
}));

import { applyChunk, fehlerText } from "./chunks";
import { createOrbitStore } from "./store";
import type { Nachricht, TurnChunk } from "./types";

const tick = () => new Promise((r) => setTimeout(r, 0));
const flush = async () => { for (let i = 0; i < 5; i++) await tick(); };
const lastStream = (path: string) => [...streams].reverse().find((s) => s.path === path)!;
const snapshot = (extra: any = {}) => ({ type: "snapshot", working: [], approvals: [], automations: [], steps: [], ...extra });

beforeEach(() => {
  streams.length = 0;
  requests.length = 0;
  handlers = {
    "GET /v1/bots": () => ({ ok: true, groups: [], main: null, bots: [{ id: "b1", chatId: "c1", name: "Erdi" }] }),
    "GET /v1/chats": () => ({ ok: true, chats: [] }),
    "GET /v1/automations": () => ({ ok: true, automations: [], trash: [] }),
    "GET /v1/chats/c1/messages": () => ({ messages: [], hasMore: false, interrupted: null, reactions: [] }),
  };
  connectImpl = async () => ({ port: 1, dataDir: "x" });
});

describe("applyChunk", () => {
  const run = (chunks: TurnChunk[]) => chunks.reduce<Nachricht | null>((m, c) => applyChunk(m, c), null)!;

  it("baut Text, Werkzeugkarte und Metadaten auf", () => {
    const m = run([
      { type: "start", messageId: "m1", messageMetadata: { botId: "b1" } },
      { type: "start-step" },
      { type: "text-start", id: "t1" },
      { type: "text-delta", id: "t1", delta: "Hal" },
      { type: "text-delta", id: "t1", delta: "lo" },
      { type: "text-end", id: "t1" },
      { type: "tool-input-available", toolCallId: "x", toolName: "say", input: { text: "hi" } },
      { type: "tool-output-available", toolCallId: "x", output: { ok: true } },
      { type: "file", url: "https://example.test/image.png", mediaType: "image/*", filename: "Example drawing" },
      { type: "finish-step" },
      { type: "finish", finishReason: "stop", messageMetadata: { finishedAt: "2026", steps: 1 } },
    ]);
    expect(m.id).toBe("m1");
    expect(m.parts[0]).toMatchObject({ type: "text", text: "Hallo", state: "done" });
    expect(m.parts[1]).toMatchObject({ type: "tool-say", state: "output-available", output: { ok: true } });
    expect(m.parts[2]).toEqual({ type: "file", url: "https://example.test/image.png", mediaType: "image/*", filename: "Example drawing" });
    expect(m.metadata).toMatchObject({ botId: "b1", finishedAt: "2026", steps: 1 });
  });

  it("markiert Abbruch und Fehler", () => {
    expect(run([{ type: "start", messageId: "a" }, { type: "abort", reason: "Gestoppt." }]).metadata?.aborted).toBe(true);
    expect(run([{ type: "start", messageId: "a" }, { type: "error", errorText: "Kaputt." }]).metadata?.error).toBe("Kaputt.");
  });

  it("verändert die alte Nachricht nicht", () => {
    const a = run([{ type: "start", messageId: "a" }, { type: "text-start", id: "t" }]);
    const b = applyChunk(a, { type: "text-delta", id: "t", delta: "x" })!;
    expect((a.parts[0] as any).text).toBe("");
    expect((b.parts[0] as any).text).toBe("x");
  });
});

describe("fehlerText", () => {
  it("übernimmt Fehlermeldungen und verwendet bei fehlenden Angaben den englischen Standardtext", () => {
    expect(fehlerText("Chat nicht gefunden.")).toBe("Chat nicht gefunden.");
    expect(fehlerText(new Error("Zugriff verweigert."))).toBe("Zugriff verweigert.");
    expect(fehlerText({ error: "Ungültige Anfrage." })).toBe("Ungültige Anfrage.");
    expect(fehlerText(undefined)).toBe("Something went wrong. Please try again.");
  });
});

describe("Store: Verbindung", () => {
  it("verbindet, nimmt den Snapshot und lädt Bots", async () => {
    const st = createOrbitStore({ sleep: async () => {} });
    await st.getState().connect();
    await flush();
    const ev = lastStream("/v1/events");
    expect(ev).toBeTruthy();
    ev.onEvent(snapshot({
      working: [{ chatId: "c1", botId: "b1", status: "arbeitet" }],
      approvals: [{ id: "k1", kind: "approval", chatId: "c1", botId: "b1" }],
      steps: [{ chatId: "c1", botId: "b1", toolCallId: "t", label: "Lese", tool: "read", step: 1, at: 1 }],
    }));
    await flush();
    const s = st.getState();
    expect(s.verbindung).toBe("verbunden");
    expect(s.bereit).toBe(true);
    expect(s.working["c1:b1"].status).toBe("arbeitet");
    expect(s.cards).toHaveLength(1);
    expect(s.steps[0].label).toBe("Lese");
    expect(s.bots[0].name).toBe("Erdi");
    st.getState().disconnect();
  });

  it("verbindet nach Abbruch mit Backoff neu und ersetzt den Stand durch den neuen Snapshot", async () => {
    const waits: number[] = [];
    const st = createOrbitStore({ sleep: async (ms) => { waits.push(ms); } });
    await st.getState().connect();
    await flush();
    lastStream("/v1/events").onEvent(snapshot({ working: [{ chatId: "c1", botId: "b1", status: "arbeitet" }] }));
    lastStream("/v1/events").reject("Verbindung getrennt.");
    await flush();
    expect(streams.filter((s) => s.path === "/v1/events")).toHaveLength(2);
    lastStream("/v1/events").onEvent(snapshot());
    await flush();
    const s = st.getState();
    expect(s.neuverbunden).toBe(1);
    expect(s.working).toEqual({});
    expect(waits[0]).toBe(500);
    st.getState().disconnect();
  });

  it("wiederholt bei Fehler von service_connect und zeigt den Text", async () => {
    let n = 0;
    connectImpl = async () => { if (++n < 3) throw "Der Dienst konnte nicht gestartet werden."; return { port: 1, dataDir: "x" }; };
    const waits: number[] = [];
    const st = createOrbitStore({ sleep: async (ms) => { waits.push(ms); } });
    await st.getState().connect();
    await flush();
    expect(n).toBe(3);
    expect(waits.slice(0, 2)).toEqual([500, 1000]);
    expect(streams.filter((s) => s.path === "/v1/events")).toHaveLength(1);
    st.getState().disconnect();
  });

  it("zeigt den Fehlertext, solange die Verbindung fehlt", async () => {
    connectImpl = async () => { throw "Der Dienst konnte nicht gestartet werden."; };
    const st = createOrbitStore({ sleep: () => new Promise(() => {}) });
    await st.getState().connect();
    await flush();
    expect(st.getState().verbindungsfehler).toBe("Der Dienst konnte nicht gestartet werden.");
    expect(st.getState().verbindung).toBe("verbindet");
    st.getState().disconnect();
  });
});

async function verbunden() {
  const st = createOrbitStore({ sleep: async () => {} });
  await st.getState().connect();
  await flush();
  lastStream("/v1/events").onEvent(snapshot());
  await flush();
  return st;
}

describe("Store: Chat", () => {
  it("zeigt die Nutzer-Nachricht sofort und baut die Antwort live auf", async () => {
    const st = await verbunden();
    st.getState().setChatModell("c1", { model: "gpt-6-luna", effort: "high", fast: false });
    const p = st.getState().send("c1", "Hallo", [], "b1");
    await flush();
    let msgs = st.getState().messages.c1;
    expect(msgs[0]).toMatchObject({ role: "user", metadata: { pending: true } });
    const turn = lastStream("/v1/chats/c1/turn");
    expect(turn.body.messages[0].parts[0]).toEqual({ type: "text", text: "Hallo" });
    expect(turn.body.botId).toBe("b1");
    expect(turn.body.clientData).toEqual({ model: "gpt-6-luna", effort: "high", fast: false, botId: "b1" });
    turn.onEvent({ type: "start", messageId: "m9", messageMetadata: { botId: "b1" } });
    turn.onEvent({ type: "text-start", id: "t" });
    turn.onEvent({ type: "text-delta", id: "t", delta: "Hi" });
    msgs = st.getState().messages.c1;
    expect(msgs).toHaveLength(2);
    expect((msgs[1].parts[0] as any).text).toBe("Hi");
    expect(msgs[0].metadata?.pending).toBe(false);
    expect(st.getState().streaming.c1).toBe(true);
    turn.onEvent({ type: "text-end", id: "t" });
    turn.onEvent({ type: "finish", finishReason: "stop", messageMetadata: { steps: 1 } });
    turn.resolve();
    await p;
    expect(st.getState().streaming.c1).toBeUndefined();
    expect(st.getState().messages.c1[1].metadata?.steps).toBe(1);
    st.getState().setChatModell("c1", null);
    const standard = st.getState().send("c1", "Wieder Standard");
    await flush();
    const standardTurn = lastStream("/v1/chats/c1/turn");
    expect(standardTurn.body.clientData).toBeUndefined();
    standardTurn.resolve();
    await standard;
    st.getState().disconnect();
  });

  it("markiert die Nachricht bei Fehler als fehlgeschlagen und nennt den Text", async () => {
    const st = await verbunden();
    const p = st.getState().send("c1", "Hallo");
    await flush();
    lastStream("/v1/chats/c1/turn").reject("Chat ist nicht verfügbar.");
    await p;
    const s = st.getState();
    expect(s.messages.c1[0].metadata).toMatchObject({ failed: true, pending: false });
    expect(s.notices.c1).toBe("Chat ist nicht verfügbar.");
    st.getState().disconnect();
  });

  it("übernimmt error-Chunk und abort in die Antwort", async () => {
    const st = await verbunden();
    const p = st.getState().send("c1", "x");
    await flush();
    const t = lastStream("/v1/chats/c1/turn");
    t.onEvent({ type: "start", messageId: "m1" });
    t.onEvent({ type: "error", errorText: "Das Modell ist nicht erreichbar." });
    t.onEvent({ type: "finish", finishReason: "error" });
    t.resolve();
    await p;
    expect(st.getState().messages.c1[1].metadata?.error).toBe("Das Modell ist nicht erreichbar.");
    expect(st.getState().notices.c1).toBe("Das Modell ist nicht erreichbar.");
    st.getState().disconnect();
  });

  it("lädt Nachrichten und ältere Seiten mit before", async () => {
    handlers["GET /v1/chats/c1/messages"] = (_b) => ({ messages: [{ id: "m5", role: "user", parts: [] }], hasMore: true, interrupted: { runId: "r1", at: "a", startedAt: "s", steps: 2 }, reactions: [] });
    const st = await verbunden();
    await st.getState().selectChat("c1");
    expect(st.getState().interrupted.c1?.runId).toBe("r1");
    handlers["GET /v1/chats/c1/messages"] = () => ({ messages: [{ id: "m4", role: "user", parts: [] }], hasMore: false, interrupted: null, reactions: [] });
    await st.getState().loadOlder("c1");
    expect(st.getState().messages.c1.map((m) => m.id)).toEqual(["m4", "m5"]);
    expect(requests.some((r) => r.path.includes("limit=50&before=m5"))).toBe(true);
    expect(st.getState().hasMore.c1).toBe(false);
    st.getState().disconnect();
  });

  it("Stopp und Weiter nach Unterbrechung rufen die Routen auf", async () => {
    handlers["GET /v1/chats/c1/messages"] = () => ({ messages: [], interrupted: { runId: "r7", at: "a", startedAt: "s", steps: 1 }, reactions: [] });
    const st = await verbunden();
    await st.getState().selectChat("c1");
    await st.getState().stop("c1");
    expect(requests.some((r) => r.method === "POST" && r.path === "/v1/chats/c1/stop")).toBe(true);
    await st.getState().resume("c1");
    expect(requests.find((r) => r.path === "/v1/chats/c1/resume")?.body).toEqual({ runId: "r7" });
    expect(st.getState().interrupted.c1).toBeNull();
    expect(lastStream("/v1/chats/c1/stream")).toBeTruthy();
    st.getState().disconnect();
  });

  it("zählt Ungelesenes für nicht gewählte Chats und hängt sich bei Arbeit an", async () => {
    const st = await verbunden();
    lastStream("/v1/events").onEvent({ type: "orbi-message", chatId: "c2", messageId: "m" });
    expect(st.getState().unread.c2).toBe(1);
    await st.getState().selectChat("c1");
    lastStream("/v1/events").onEvent({ type: "status", chatId: "c1", botId: "b1", status: "arbeitet" });
    await flush();
    expect(streams.some((s) => s.path === "/v1/chats/c1/stream")).toBe(true);
    lastStream("/v1/events").onEvent({ type: "status", chatId: "c1", botId: "b1", status: "fertig" });
    expect(st.getState().working["c1:b1"]).toBeUndefined();
    await st.getState().selectChat("c2");
    expect(st.getState().unread.c2).toBeUndefined();
    st.getState().disconnect();
  });

  it("senden bei laufendem Strom: früh endender Turn-Strom lässt den angehängten Strom bestehen", async () => {
    const st = await verbunden();
    await st.getState().selectChat("c1");
    lastStream("/v1/events").onEvent({ type: "status", chatId: "c1", botId: "b1", status: "arbeitet" });
    await flush();
    const att = lastStream("/v1/chats/c1/stream");
    att.onEvent({ type: "start", messageId: "m1" });
    att.onEvent({ type: "text-start", id: "t" });
    att.onEvent({ type: "text-delta", id: "t", delta: "A" });
    const p = st.getState().send("c1", "noch eins");
    await flush();
    lastStream("/v1/chats/c1/turn").resolve(); // 204: Chat belegt
    await p;
    expect(st.getState().streaming.c1).toBe(true); // der angehängte Strom läuft weiter
    att.onEvent({ type: "text-delta", id: "t", delta: "B" });
    const ant = st.getState().messages.c1.filter((m) => m.id === "m1");
    expect(ant).toHaveLength(1);
    expect((ant[0].parts[0] as any).text).toBe("AB");
    expect(st.getState().messages.c1.find((m) => m.role === "user")?.metadata?.pending).toBe(false);
    att.resolve();
    await flush();
    expect(st.getState().streaming.c1).toBeUndefined();
    st.getState().disconnect();
  });

  it("verwirft veraltete Antworten beim Nachladen (letzte Anfrage gewinnt)", async () => {
    const st = await verbunden();
    const warte: ((v: any) => void)[] = [];
    handlers["GET /v1/chats/c1/messages"] = () => new Promise((r) => warte.push(r));
    const a = st.getState().loadMessages("c1");
    const b = st.getState().loadMessages("c1");
    await flush();
    warte[1]({ messages: [{ id: "neu", role: "assistant", parts: [] }], hasMore: false });
    await b;
    warte[0]({ messages: [{ id: "alt", role: "assistant", parts: [] }], hasMore: false });
    await a;
    expect(st.getState().messages.c1.map((m) => m.id)).toEqual(["neu"]);
    expect(st.getState().laden.c1).toBe(false);
    let chats: ((v: any) => void)[] = [];
    handlers["GET /v1/chats"] = () => new Promise((r) => chats.push(r));
    const c = st.getState().loadChats();
    const d = st.getState().loadChats();
    await flush();
    chats[1]({ chats: [{ id: "neu" }] });
    await d;
    chats[0]({ chats: [{ id: "alt" }] });
    await c;
    expect(st.getState().chats.map((x: any) => x.id)).toEqual(["neu"]);
    st.getState().disconnect();
  });

  it("behält beim Nachladen die laufende Strom-Nachricht mit echter ID", async () => {
    const st = await verbunden();
    await st.getState().selectChat("c1");
    const p = st.getState().send("c1", "Hallo");
    await flush();
    const t = lastStream("/v1/chats/c1/turn");
    t.onEvent({ type: "start", messageId: "echt-1" });
    t.onEvent({ type: "text-start", id: "x" });
    t.onEvent({ type: "text-delta", id: "x", delta: "Teil" });
    await st.getState().loadMessages("c1"); // Dienst kennt die Antwort noch nicht
    expect(st.getState().messages.c1.some((m) => m.id === "echt-1")).toBe(true);
    t.resolve();
    await p;
    st.getState().disconnect();
  });
});

describe("Store: Karten und Routinen", () => {
  it("Freigabe: Karte erscheint per Ereignis, verschwindet bei Entscheidung, kommt bei Fehler zurück", async () => {
    const st = await verbunden();
    const ev = lastStream("/v1/events");
    ev.onEvent({ type: "approval", id: "k1", kind: "approval", chatId: "c1", botId: "b1", status: "pending" });
    expect(st.getState().cards).toHaveLength(1);
    handlers["POST /v1/approvals/k1/decide"] = () => { throw "Die Entscheidung konnte nicht gespeichert werden."; };
    await st.getState().decide("k1", "once");
    expect(st.getState().cards).toHaveLength(1);
    expect(st.getState().notices.c1).toMatch(/nicht gespeichert/);
    handlers["POST /v1/approvals/k1/decide"] = () => ({ ok: true });
    await st.getState().decide("k1", "deny");
    expect(st.getState().cards).toHaveLength(0);
    ev.onEvent({ type: "approval", id: "k2", kind: "approval", chatId: "c1", botId: "b1", status: "pending" });
    ev.onEvent({ type: "approval", id: "k2", kind: "approval", chatId: "c1", botId: "b1", status: "approved" });
    expect(st.getState().cards).toHaveLength(0);
    st.getState().disconnect();
  });

  it("Rückfrage antworten und überspringen", async () => {
    const st = await verbunden();
    lastStream("/v1/events").onEvent({ type: "question", id: "q1", kind: "ask", chatId: "c1", botId: "b1" });
    await st.getState().answer("q1", [{ question: "Wie?", answers: ["So"] }]);
    expect(requests.find((r) => r.path === "/v1/questions/q1/answer")?.body).toEqual({ answers: [{ question: "Wie?", answers: ["So"] }] });
    await st.getState().answer("q1", null);
    expect(requests.filter((r) => r.path === "/v1/questions/q1/answer")[1].body).toEqual({ skipped: true });
    st.getState().disconnect();
  });

  it("Live-Schritte kommen und gehen mit status-step", async () => {
    const st = await verbunden();
    const ev = lastStream("/v1/events");
    ev.onEvent({ type: "status-step", chatId: "c1", botId: "b1", toolCallId: "t1", label: "Suche", tool: "web", step: 1, at: 1, state: "start" });
    expect(st.getState().steps).toHaveLength(1);
    ev.onEvent({ type: "status-step", chatId: "c1", botId: "b1", toolCallId: "t1", label: "Suche", tool: "web", step: 1, at: 2, state: "end" });
    expect(st.getState().steps).toHaveLength(0);
    st.getState().disconnect();
  });

  it("Desktop-Ereignis aktualisiert Computer-Status", async () => {
    const { useDesktop } = await import("../features/routinen/computer");
    useDesktop.setState({ desk: { b1: { state: "running" } } });
    const st = await verbunden();
    const ev = lastStream("/v1/events");
    ev.onEvent({ type: "desktop", botId: "b1", state: "sleeping" });
    expect(useDesktop.getState().desk.b1?.state).toBe("sleeping");
    st.getState().disconnect();
  });

  it("Routine pausieren lädt die Liste neu", async () => {
    const st = await verbunden();
    await st.getState().setRoutineEnabled("a1", false);
    expect(requests.find((r) => r.path === "/v1/automations/a1/enabled")?.body).toEqual({ enabled: false });
    expect(requests.filter((r) => r.path === "/v1/automations" && r.method === "GET").length).toBeGreaterThan(1);
    st.getState().disconnect();
  });
});
