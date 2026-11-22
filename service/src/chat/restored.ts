import type { AskUserOutput } from "@/lib/chat/ask-user"

// Antwort auf eine Rückfrage, deren Lauf ein Neustart beendet hat: als Nachricht von Consti, damit der Orbi damit weitermacht.
export function askAnswerText(_input: unknown, answer: AskUserOutput): string {
  if ("skipped" in answer && answer.skipped) return "Deine letzte Rückfrage habe ich übersprungen. Mach mit dem weiter, was du hast."
  const rows = "answers" in answer ? answer.answers : []
  if (rows.length === 1) return `Antwort auf deine Rückfrage „${rows[0].question}“: ${rows[0].answers.join(", ") || "(keine Auswahl)"}`
  return ["Antworten auf deine Rückfragen:", ...rows.map((row) => `- ${row.question}: ${row.answers.join(", ") || "(keine Auswahl)"}`)].join("\n")
}
