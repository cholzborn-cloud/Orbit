import { z } from "zod"

// Frage-Tool: der Orbi stellt eine Frage, der Nutzer tippt auf Antworten. Das Tool hat kein `execute`,
// die Antwort kommt vom Browser (addToolOutput).
export const ASK_USER = "ask_user"

export const ASK_USER_DESCRIPTION =
  "Ask the user tappable questions at a real fork where the answer changes the result. 1-5 questions per call, 2-4 options each, exactly one recommended. Then stop; the answer comes back."

const question = z.object({
  question: z.string().describe("The question, one sentence"),
  options: z
    .array(
      z.object({
        label: z.string().describe("Short answer, at most 5 words"),
        description: z.string().optional().describe("One short helpful line"),
        recommended: z
          .boolean()
          .optional()
          .describe("true for exactly one option: your recommendation"),
      })
    )
    .min(2)
    .max(4),
  multiple: z
    .boolean()
    .optional()
    .describe("true if several answers may be chosen, default single choice"),
})

export const askUserInput = z.object({
  questions: z
    .array(question)
    .min(1)
    .max(5)
    .describe("Up to 5 questions, shown one page after another"),
})

export type AskUserInput = z.infer<typeof askUserInput>
// Übersprungene Fragen haben `answers: []`; `skipped` = Nutzer hat alles geschlossen.
export type AskUserOutput =
  | { answers: { question: string; answers: string[] }[]; skipped?: undefined }
  | { skipped: true; answers?: undefined }

type Part = { type: string; state?: string }

// Nach der Antwort läuft der Turn automatisch weiter, aber nur wenn der letzte Schritt eine beantwortete Frage war.
export function answeredAskUser({
  messages,
}: {
  messages: { role: string; parts: Part[] }[]
}) {
  const last = messages.at(-1)
  if (last?.role !== "assistant") return false
  const step = last.parts.slice(
    last.parts.map((p) => p.type).lastIndexOf("step-start") + 1
  )
  const asks = step.filter((p) => p.type === `tool-${ASK_USER}`)
  return asks.length > 0 && asks.every((p) => p.state === "output-available")
}
