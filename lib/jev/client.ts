const URL = "https://openrouter.ai/api/alpha/decisions"
const MODEL = "typesafe/jev-1.13"
let pausedUntil = 0

export function resetJevPause() {
  pausedUntil = 0
}

// Tagesbudget (Phase 5): der Dienst setzt hier eine Prüfung. Gibt sie einen Text zurück, fragt decide() gar nicht erst an
// und liefert ok:false (der Aufrufer fällt dann wie bei jedem Jev-Ausfall auf das Standardmodell zurück).
let gate: (() => string | null) | undefined
export function setJevGate(next: (() => string | null) | undefined) {
  gate = next
}

export type JevQuestion = {
  type: "choice" | "score" | "noul"
  instructions: string
  criteria: Record<string, string> | string[]
}

export type JevDecision =
  | {
      ok: true
      answers: Record<string, Record<string, unknown>>
      durationMs: number
      // Kosten laut OpenRouter (`usage.cost`), falls geliefert; geht ins Jev-Protokoll.
      costUsd?: number
    }
  | { ok: false; error: string }

export async function decide(
  questions: Record<string, JevQuestion>,
  state: unknown,
  options: { signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<JevDecision> {
  if (Date.now() < pausedUntil)
    return { ok: false, error: "Jev ist vorübergehend pausiert." }
  try {
    const blocked = gate?.()
    if (blocked) return { ok: false, error: blocked }
  } catch {
    /* Budget nicht lesbar: Jev läuft weiter wie bisher */
  }
  const key = process.env.OPENROUTER_JEV_API_KEY
  if (!key) return { ok: false, error: "Jev-Schlüssel fehlt." }

  const controller = new AbortController()
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? 3000
  )
  const abort = () => controller.abort(options.signal?.reason)
  options.signal?.addEventListener("abort", abort, { once: true })
  const started = Date.now()
  try {
    const response = await fetch(URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: MODEL, state, questions }),
      signal: controller.signal,
    })
    if (!response.ok) {
      pausedUntil = Date.now() + 3 * 60_000
      return {
        ok: false,
        error: `Jev-Anfrage fehlgeschlagen (${response.status}).`,
      }
    }
    const body: unknown = await response.json()
    if (!body || typeof body !== "object")
      return { ok: false, error: "Ungültige Jev-Antwort." }
    const data = body as { answers?: unknown; usage?: { cost?: unknown } }
    if (!data.answers || typeof data.answers !== "object")
      return { ok: false, error: "Ungültige Jev-Antwort." }
    return {
      ok: true,
      answers: data.answers as Record<string, Record<string, unknown>>,
      durationMs: Date.now() - started,
      ...(typeof data.usage?.cost === "number" &&
        Number.isFinite(data.usage.cost) && { costUsd: data.usage.cost }),
    }
  } catch (error) {
    pausedUntil = Date.now() + 3 * 60_000
    return {
      ok: false,
      error:
        error instanceof Error && error.name === "AbortError"
          ? "Jev-Anfrage abgelaufen."
          : "Jev ist nicht erreichbar.",
    }
  } finally {
    clearTimeout(timeout)
    options.signal?.removeEventListener("abort", abort)
  }
}
