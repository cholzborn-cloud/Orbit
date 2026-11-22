// Baut aus Turn-Chunks (SCHNITTSTELLE.md Abschnitt 4) schrittweise eine Antwort-Nachricht.
import type { Nachricht, TextPart, ToolPart, TurnChunk } from "./types";

export const FEHLER_STANDARD = "Something went wrong. Please try again.";

/** Turns any error value (service string, Error, {error}) into readable text. */
export function fehlerText(e: unknown): string {
  if (typeof e === "string" && e.trim()) return e;
  if (e instanceof Error && e.message) return e.message;
  if (e && typeof e === "object") {
    const o = e as { error?: unknown; message?: unknown; errorText?: unknown };
    for (const v of [o.error, o.errorText, o.message]) if (typeof v === "string" && v.trim()) return v;
  }
  return FEHLER_STANDARD;
}

let zaehler = 0;

/**
 * Wendet einen Chunk auf die laufende Antwort an. Gibt immer ein neues Objekt zurück (unveränderlich),
 * damit die Oberfläche neu zeichnet. `msg` ist null, solange noch kein `start` kam.
 */
export function applyChunk(msg: Nachricht | null, chunk: TurnChunk): Nachricht | null {
  if (chunk.type === "start") {
    return { id: chunk.messageId, role: "assistant", parts: [], metadata: { ...chunk.messageMetadata } };
  }
  // Fehlt der Anfang (z. B. spät angehängt), eine Antwort mit Platzhalter-ID beginnen.
  const cur: Nachricht = msg ?? { id: `stream-${++zaehler}`, role: "assistant", parts: [], metadata: {} };
  switch (chunk.type) {
    case "text-start":
      return { ...cur, parts: [...cur.parts, { type: "text", id: chunk.id, text: "", state: "streaming" }] };
    case "text-delta": {
      const i = cur.parts.findIndex((p) => p.type === "text" && p.id === chunk.id);
      if (i < 0) {
        return { ...cur, parts: [...cur.parts, { type: "text", id: chunk.id, text: chunk.delta, state: "streaming" }] };
      }
      const parts = cur.parts.slice();
      const t = parts[i] as TextPart;
      parts[i] = { ...t, text: t.text + chunk.delta };
      return { ...cur, parts };
    }
    case "text-end":
      return {
        ...cur,
        parts: cur.parts.map((p) => (p.type === "text" && p.id === chunk.id ? { ...p, state: "done" as const } : p)),
      };
    case "memo":
    case "file":
      return { ...cur, parts: [...cur.parts, chunk] };
    case "tool-input-available": {
      const part: ToolPart = {
        type: `tool-${chunk.toolName}`,
        toolCallId: chunk.toolCallId,
        state: "input-available",
        input: chunk.input,
      };
      const i = cur.parts.findIndex((p) => "toolCallId" in p && p.toolCallId === chunk.toolCallId);
      if (i >= 0) {
        const parts = cur.parts.slice();
        parts[i] = part;
        return { ...cur, parts };
      }
      return { ...cur, parts: [...cur.parts, part] };
    }
    case "tool-output-available":
      return {
        ...cur,
        parts: cur.parts.map((p) =>
          "toolCallId" in p && p.toolCallId === chunk.toolCallId
            ? { ...p, state: "output-available" as const, output: chunk.output }
            : p,
        ),
      };
    case "abort":
      return { ...cur, metadata: { ...cur.metadata, aborted: true } };
    case "error":
      return { ...cur, metadata: { ...cur.metadata, error: chunk.errorText || FEHLER_STANDARD } };
    case "finish":
      return {
        ...cur,
        parts: cur.parts.map((p) => (p.type === "text" && p.state === "streaming" ? { ...p, state: "done" as const } : p)),
        metadata: { ...cur.metadata, ...chunk.messageMetadata },
      };
    default:
      return cur; // start-step, finish-step und Unbekanntes ändern nichts
  }
}

/** Gesamttext einer Nachricht (nur Textteile). */
export const nachrichtText = (m: Nachricht) =>
  m.parts.filter((p): p is TextPart => p.type === "text").map((p) => p.text).join("");
