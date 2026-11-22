// Upcoming delivery shapes (SendToUser, images with alt, choice widget, memo, thread marker) and orbit:// links.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../lib/api";
import { useOrbit } from "../../lib/store";
import { useNav } from "../../lib/nav";
import type { ChoiceWidget, MemoPart, Nachricht, SendToUserInput, ToolPart } from "../../lib/types";
import { useEinst } from "../einstellungen/store";
import { baueVerlauf, textVon, vorschau } from "./logik";
import { Markdown } from "./markdown";
import { Verlauf } from "./verlauf";

vi.mock("../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../lib/api")>("../../lib/api");
  return { ...actual, answerWidget: vi.fn(async () => ({ ok: true })), answerSecret: vi.fn(async () => ({ ok: true })) };
});

const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==";
const wav = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";

const send = (id: string, input: SendToUserInput, output?: unknown): ToolPart => ({ type: "tool-SendToUser", toolCallId: id, state: output ? "output-available" : "input-available", input, output });
const widget: ChoiceWidget = {
  prompt: "Which plan?",
  options: [{ id: "a", label: "Keep it", style: "primary" }, { id: "b", label: "Delete it", style: "danger" }, { id: "c", label: "Later" }],
};
const memo: MemoPart = { type: "memo", url: wav, mediaType: "audio/wav", durationMs: 65_000, title: "Morning memo" };

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.mocked(api.answerWidget).mockClear().mockResolvedValue({ ok: true, replyMessageId: "reply-fixture" });
  vi.mocked(api.answerSecret).mockClear().mockResolvedValue({ ok: true, replyMessageId: "reply-fixture" });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  useOrbit.setState({ messages: {}, bots: [], main: null, groups: [] });
  useNav.setState({ main: { kind: "chat" }, panel: null, editor: null });
  useEinst.setState({ anker: null });
});

function zeige(messages: Nachricht[], onErneut = vi.fn()) {
  act(() => { useOrbit.setState({ messages: { c1: messages } }); });
  render(<Verlauf chatId="c1" gruppe={false} bot={null} mitglieder={[]} farbe="blau" onErneut={onErneut} />);
  return onErneut;
}

describe("existing parts are unchanged", () => {
  it("builds the same rows for text, file, say, ask_user and other tools", () => {
    const m: Nachricht = {
      id: "m", role: "assistant", metadata: { botId: "mira" },
      parts: [
        { type: "text", text: "Hi" },
        { type: "file", url: png, mediaType: "image/png", filename: "a.png" },
        { type: "tool-say", toolCallId: "s1", state: "input-available", input: { text: "Said" } },
        { type: "tool-ask_user", toolCallId: "q1", state: "input-available", input: { question: "Q?" } },
        { type: "tool-automation_create", toolCallId: "t1", state: "output-available", input: { name: "Daily" }, output: {} },
      ],
    };
    const rows = baueVerlauf([m], { gruppe: false }).map(({ ts: _ts, ...r }) => r);
    expect(rows.map((r) => r.t)).toEqual(["orbi", "datei", "orbi", "frage", "system"]);
    expect(rows[0]).toMatchObject({ key: "m~t0", blase: { art: "text", text: "Hi", streaming: false } });
    expect(rows[1]).toMatchObject({ key: "m~f1", datei: { url: png, mediaType: "image/png", filename: "a.png" } });
    expect(rows[2]).toMatchObject({ key: "m~ss1", blase: { art: "say", text: "Said" } });
    expect(rows[3]).toMatchObject({ key: "q-m-q1", toolCallId: "q1", offen: false });
    expect(rows[4]).toMatchObject({ key: "s-m-t1", detail: "Daily", symbol: "clock" });
  });

  it("skips unknown or broken parts instead of crashing", () => {
    const m = { id: "x", role: "assistant", parts: [null, { foo: 1 }, { type: "future-thing" }, { type: "text", text: "ok" }] } as unknown as Nachricht;
    expect(baueVerlauf([m], { gruppe: false }).map((r) => r.t)).toEqual(["orbi"]);
  });
});

describe("SendToUser and new parts", () => {
  it("renders Markdown text, images with alt text and a thread marker", () => {
    const m: Nachricht = {
      id: "m1", role: "assistant",
      parts: [send("u1", { markdown: "**Done** for today", images: [{ url: png, alt: "Chart of steps", mediaType: "image/png" }], replyTo: { messageId: "u0", name: "You", text: "Status?" } })],
    };
    zeige([m]);
    expect(screen.getByText("Done").closest("strong")).toBeTruthy();
    expect(screen.getByRole("img", { name: "Chart of steps" })).toBeTruthy();
    expect(screen.getByText("Reply in thread to You: Status?")).toBeTruthy();
    expect(textVon(m)).toBe("**Done** for today");
    expect(vorschau(m)).toBe("Done for today");
  });

  it("shows a standalone image part with its alt text", () => {
    zeige([{ id: "m2", role: "assistant", parts: [{ type: "image", url: png, alt: "A cat", mediaType: "image/png" }] }]);
    expect(screen.getByRole("img", { name: "A cat" })).toBeTruthy();
  });

  it("answers a single-choice widget through the normal send path", async () => {
    const onErneut = zeige([{ id: "m3", role: "assistant", parts: [send("w1", { widget })] }]);
    expect(screen.getByRole("group", { name: "Which plan?" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Keep it" }).getAttribute("data-art")).toBe("primaer");
    expect(screen.getByRole("button", { name: "Delete it" }).getAttribute("data-art")).toBe("gefahr");
    fireEvent.click(screen.getByRole("button", { name: "Delete it" }));
    await waitFor(() => expect(api.answerWidget).toHaveBeenCalledWith("w1", { selected: ["b"] }));
    expect(onErneut).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Keep it" })).toBeNull();
  });

  it("keeps a failed choice open and leaves the chat reply to the service", async () => {
    vi.mocked(api.answerWidget).mockResolvedValueOnce({ ok: false });
    const reply = zeige([{ id: "m", role: "assistant", parts: [send("w", { widget })] }]);
    fireEvent.click(screen.getByRole("button", { name: "Later" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(reply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Later" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Later" })).toBeNull());
    expect(reply).not.toHaveBeenCalled();
  });

  it("supports multi-select with custom input and caps options at six", async () => {
    const viele: ChoiceWidget = { prompt: "Pick days", helpText: "Choose working days", multiple: true, allowCustom: true, options: ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((label) => ({ label, value: label === "Tu" ? "Tuesday" : undefined })) };
    const onErneut = zeige([{ id: "m4", role: "assistant", parts: [send("w2", { widget: viele })] }]);
    expect(screen.getByText("Choose working days")).toBeTruthy();
    expect(screen.getAllByRole("checkbox")).toHaveLength(6);
    const senden = screen.getByRole("button", { name: "Send" }) as HTMLButtonElement;
    expect(senden.disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: "Tu" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Fr" }));
    expect(screen.getByRole("checkbox", { name: "Tu" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.change(screen.getByRole("textbox", { name: "Your own answer" }), { target: { value: "every other Sunday" } });
    fireEvent.click(senden);
    await waitFor(() => expect(api.answerWidget).toHaveBeenCalledWith("w2", { selected: ["o1", "o4"], custom: "every other Sunday" }));
    expect(screen.getByText("Tuesday Fr every other Sunday").textContent).toBe("Tuesday\nFr\nevery other Sunday");
    expect(onErneut).not.toHaveBeenCalled();
  });

  it("shows an answered widget read-only", () => {
    zeige([{ id: "m5", role: "assistant", parts: [send("w3", { widget }, { selected: ["c"] })] }]);
    expect(screen.queryByRole("button", { name: "Later" })).toBeNull();
    expect(screen.getByText("Later")).toBeTruthy();
  });

  it("ignores widgets without usable options", () => {
    const rows = baueVerlauf([{ id: "m6", role: "assistant", parts: [send("w4", { widget: { options: [] } })] }], { gruppe: false });
    expect(rows).toEqual([]);
  });

  it("saves a secret-request without echoing the value", async () => {
    const onErneut = zeige([{ id: "m-sec", role: "assistant", parts: [send("s1", {
      secret: { name: "api", label: "API token", description: "Paste the token" },
    })] }]);
    const form = screen.getByRole("form", { name: "API token" });
    fireEvent.change(screen.getByPlaceholderText("Paste here"), { target: { value: "sk-secret-value" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(form).toBeTruthy();
    await waitFor(() => expect(api.answerSecret).toHaveBeenCalledWith("s1", { value: "sk-secret-value" }));
    expect(onErneut).not.toHaveBeenCalled();
    expect(screen.queryByDisplayValue("sk-secret-value")).toBeNull();
    expect(screen.getByText("Saved securely")).toBeTruthy();
  });

  it("keeps secure input masked until the service confirms and allows a manual retry", async () => {
    let rejectAttempt!: (error: Error) => void;
    vi.mocked(api.answerSecret).mockReturnValueOnce(new Promise((_, reject) => { rejectAttempt = reject; }));
    const reply = zeige([{ id: "m", role: "assistant", parts: [send("s", { secret: { name: "api", label: "Token" } })] }]);
    const field = screen.getByPlaceholderText("Paste here") as HTMLInputElement;
    const value = "private-test-fixture";
    expect(field.type).toBe("password");
    fireEvent.change(field, { target: { value } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(field.disabled).toBe(true);
    expect(screen.queryByText("Saved securely")).toBeNull();
    await act(async () => rejectAttempt(new Error(value)));
    expect(screen.getByRole("alert").textContent).not.toContain(value);
    expect(field.value).toBe(value);
    expect(reply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByText("Saved securely")).toBeTruthy());
    expect(screen.queryByPlaceholderText("Paste here")).toBeNull();
    expect(reply).not.toHaveBeenCalled();
  });

  it("plays, pauses and replays a memo", async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => Promise.resolve());
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    zeige([{ id: "m7", role: "assistant", parts: [memo] }]);
    expect(screen.getByText("1:05")).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Play Morning memo" })); });
    expect(play).toHaveBeenCalledTimes(1);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Pause Morning memo" })); });
    expect(pause).toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Replay Morning memo" })); });
    expect(play).toHaveBeenCalledTimes(2);
  });

  it("says when a memo is not local audio", () => {
    zeige([{ id: "m8", role: "assistant", parts: [send("a1", { memo: { url: "https://example.com/a.mp3" } })] }]);
    expect(screen.getByText(/Audio is not available locally/)).toBeTruthy();
  });

  it("shows a thread marker from message metadata", () => {
    zeige([{ id: "m9", role: "assistant", metadata: { thread: { messageId: "x", name: "Mira" } }, parts: [{ type: "text", text: "In thread" }] }]);
    expect(screen.getByText("Reply in thread to Mira")).toBeTruthy();
  });
});

describe("orbit:// links in chat Markdown", () => {
  beforeEach(() => {
    useOrbit.setState({ bots: [{ id: "mira", chatId: "c-mira", name: "Mira" } as any], main: null, groups: [], selectChat: vi.fn(async () => {}) as any });
  });

  it("opens settings with the section anchor instead of the browser", async () => {
    render(<Markdown text="Open [notifications](orbit://settings/notifications)." />);
    const link = screen.getByRole("link", { name: "notifications" });
    await act(async () => { fireEvent.click(link); });
    expect(useNav.getState().main).toEqual({ kind: "einstellungen", page: "allgemein" });
    expect(useEinst.getState().anker).toBe("notifications");
  });

  it("opens an Orbi tab", async () => {
    render(<Markdown text="[routines](orbit://orbi/mira/routines)" />);
    await act(async () => { fireEvent.click(screen.getByRole("link", { name: "routines" })); });
    expect(useOrbit.getState().selectChat).toHaveBeenCalledWith("c-mira");
    expect(useNav.getState().panel).toBe("uebersicht");
  });

  it("shows unavailable and unknown destinations instead of a dead link", () => {
    render(<Markdown text="[mic](orbit://settings/microphone) and [x](orbit://nowhere) and [o](orbit://orbi/ghost/routines)" />);
    const tote = document.querySelectorAll('[data-orbit-link="unavailable"]');
    expect(tote).toHaveLength(3);
    expect(screen.getAllByText("(not available in this build)")).toHaveLength(3);
    expect(tote[0].getAttribute("title")).toMatch(/Microphone/);
    expect(document.querySelectorAll("a")).toHaveLength(0);
  });
});
