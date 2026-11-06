import { tool } from "ai"
import { z } from "zod"

import { webSearch } from "@/lib/search/web"
import {
  escapeWebResultClosingTag,
  takeSearchSlot,
} from "@/lib/search/turn-limit"

// Websuche kappen (Lauf G): Antworttext und Quellenliste begrenzen, der Rest steht im Gesamtdeckel für Tool-Ausgaben.
export const WEB_ANSWER_CHARS = 6_000
export const WEB_SOURCES = 8
export const WEB_TITLE_CHARS = 120

export function formatWebResult(output: {
  answer?: string
  sources?: { title: string; url: string }[]
  error?: string
}) {
  if (output.error) return output.error
  const answer = output.answer ?? ""
  const cut = answer.length > WEB_ANSWER_CHARS ? `${answer.slice(0, WEB_ANSWER_CHARS)}\n[answer shortened: ${answer.length} characters]` : answer
  const sources = (output.sources ?? []).slice(0, WEB_SOURCES)
  return `<web_result>${escapeWebResultClosingTag(cut)}\n\nQuellen:\n${sources.map((source, index) => `[${index + 1}] ${escapeWebResultClosingTag(source.title.slice(0, WEB_TITLE_CHARS))} – ${source.url}`).join("\n")}</web_result>`
}

export const webSearchTool = tool({
  description:
    "Use for current events or facts you cannot know. Make one focused query and cite the returned sources. Maximum three searches per turn.",
  inputSchema: z.object({ query: z.string().trim().min(1).max(500) }),
  execute: async ({ query }, { abortSignal }) => {
    if (!takeSearchSlot(abortSignal))
      return { error: "Pro Nachricht sind höchstens drei Websuchen möglich." }
    const result = await webSearch({ query, signal: abortSignal })
    return result.ok
      ? { answer: result.answer, sources: result.sources }
      : { error: result.error }
  },
  toModelOutput: ({ output }) => ({ type: "text", value: formatWebResult(output) }),
})
