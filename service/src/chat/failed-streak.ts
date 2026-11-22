// Wie viele Schritte am Ende des Turns hintereinander nur Werkzeug-Fehlschläge hatten (Fehler-Ausgabe oder `{ error }`).
// Grenze der Serie (Tests, die absichtlich viele Fehlschläge brauchen, setzen sie hoch).
export const failedStreakLimit = { value: 3 }

type StepLike = { content?: readonly { type: string; output?: unknown }[] }

const failed = (part: { type: string; output?: unknown }) =>
  part.type === "tool-error" || (part.type === "tool-result" && !!part.output && typeof part.output === "object" && "error" in (part.output as object))

export function failedStreak(steps: readonly StepLike[]): number {
  let count = 0
  for (let index = steps.length - 1; index >= 0; index--) {
    const results = (steps[index]!.content ?? []).filter((part) => part.type === "tool-result" || part.type === "tool-error")
    if (!results.length || !results.every(failed)) break
    count++
  }
  return count
}
