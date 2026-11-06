// Client-sicher: nur Katalog und Beschriftungen, keine Keys.
import type { JevInfo } from "@/lib/jev/types"

export type Effort = "low" | "medium" | "high" | "xhigh" | "max"

export const EFFORT_LABELS: Record<Effort, string> = {
  low: "Low",
  medium: "Mid",
  high: "High",
  xhigh: "XHigh",
  max: "Max",
}

export type ChatModel = {
  id: string // stabile Orbit-ID (bleibt für Verlauf, Jev-Stufen und gemerkte Modelle)
  label: string // nur Anzeige, ohne Anbieter-Präfix
  description: string // Kurzbeschreibung unter dem Namen
  provider: "anthropic" | "openai" | "google"
  cli: { provider: "claude" | "codex" | "gemini" | "agy"; model: string } // welche offizielle CLI mit welchem Modellnamen
  efforts: Effort[] // von der CLI bekannte Stufen, leer = nicht einstellbar
}

// Metadaten einer Antwort (Start und Ende werden zusammengeführt).
export type ChatMetadata = {
  createdAt?: number
  automation?: { automationId: string; runId: string; name: string; status: string; startedAt: number; finishedAt?: number }
  skill?: { name: string; source: "orbit" | "brain" }
  replyTo?: string
  replyQuote?: { role: "user" | "assistant"; text: string }
  jev?: JevInfo
  botId?: string // antwortender Orbi (Gruppenchat)
  handoffFrom?: string // Nutzernachricht kam per Übergabe von diesem Orbi
  handoffGroup?: string // Übergabe stammt aus dieser Gruppe
  handoffId?: string // Turn gehört zu dieser Übergabe (Zuordnung im Session-Stream)
  kind?: "orbi-line" // gespeicherte Zeile „gesendet an / Nachricht von“ (Teil `data-orbi-message`), kein Modellaufruf
  rootTaskId?: string // Auftrag (Kette ab Constis Nachricht), zu dem die Zeile gehört
  model?: string
  effort?: string
  startedAt?: number
  finishedAt?: number
  inputTokens?: number
  cachedTokens?: number // davon aus dem Prompt-Cache gelesen
  cacheWriteTokens?: number // in den Prompt-Cache geschrieben (nur wenn der Anbieter es meldet)
  steps?: number // Modellschritte des Turns (Prompt je Anfrage = inputTokens / steps)
  costUsd?: number // Kosten nach Listenpreisen (lib/usage/prices.json), nur Richtwert
  systemChars?: number // Länge des System-Prompts (Token-Messbasis)
  outputTokens?: number
  reasoningTokens?: number
}

const FULL: Effort[] = ["low", "medium", "high", "xhigh", "max"]

// CLI-Umstellung 02.11.2026: Claude über `claude` (--effort low..max), GPT über `codex` (model_reasoning_effort low..xhigh, „Max“ gilt dort als XHigh),
// Google-Modelle über Antigravity; jede Flash-Stufe ist ein eigenes Modell.
export const CHAT_MODELS: ChatModel[] = [
  {
    id: "claude-haiku-5-5",
    cli: { provider: "claude", model: "claude-haiku-5-5" },
    description: "Schnell und günstig",
    label: "Haiku 5.5",
    provider: "anthropic",
    efforts: FULL,
  },
  {
    id: "claude-sonnet-5-5",
    cli: { provider: "claude", model: "claude-sonnet-5-5" },
    description: "Ausgewogen für den Alltag",
    label: "Sonnet 5.5",
    provider: "anthropic",
    efforts: FULL,
  },
  {
    id: "claude-opus-5-5",
    cli: { provider: "claude", model: "claude-opus-5-5" },
    description: "Stärkstes Claude, für Schweres",
    label: "Opus 5.5",
    provider: "anthropic",
    efforts: FULL,
  },
  {
    id: "gpt-6-luna",
    cli: { provider: "codex", model: "gpt-6-luna" },
    description: "Leicht und schnell",
    label: "Luna 6",
    provider: "openai",
    efforts: FULL,
  },
  {
    id: "gpt-6.1-sol",
    cli: { provider: "codex", model: "gpt-6.1-sol" },
    description: "Starkes Allround-Modell",
    label: "Sol 6.1",
    provider: "openai",
    efforts: FULL,
  },
  // Antigravity bietet die drei Flash-Stufen als eigene Modelle an.
  {
    id: "gemini-3.8-flash-high",
    cli: { provider: "agy", model: "gemini-3.8-flash-high" },
    description: "Schnell, mit tiefem Denken",
    label: "3.8 Flash High",
    provider: "google",
    efforts: [],
  },
  { id: "gemini-3.8-flash-medium", cli: { provider: "agy", model: "gemini-3.8-flash-medium" }, description: "Ausgewogen und schnell", label: "3.8 Flash Medium", provider: "google", efforts: [] },
  { id: "gemini-3.8-flash-low", cli: { provider: "agy", model: "gemini-3.8-flash-low" }, description: "Leicht und schnell", label: "3.8 Flash Low", provider: "google", efforts: [] },
]
