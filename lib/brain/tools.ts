import { tool, type ToolSet } from "ai"
import { z } from "zod"

import { brainClient } from "@/lib/brain/config"

async function modelText(
  result: ReturnType<ReturnType<typeof brainClient>["search"]>
): Promise<string> {
  const output = await result
  if (!output.ok) return output.error
  return `<brain_result>${output.data.replace(/<\/?brain_result/gi, "&lt;brain_result")}</brain_result>`
}

const compact = ({ output }: { output: string }) => ({
  type: "text" as const,
  value: output.slice(0, 4000),
})

export const brainTools: ToolSet = {
  brain_search: tool({
    description:
      "Search the user's Brain notes by filename and full text. Search before reading.",
    inputSchema: z.object({ query: z.string().min(1) }),
    execute: ({ query }) => modelText(brainClient().search(query)),
    toModelOutput: compact,
  }),
  brain_read: tool({
    description:
      "Read a Brain Markdown note, optionally limited to a heading section. Read only the relevant note or section.",
    inputSchema: z.object({ path: z.string(), section: z.string().optional() }),
    execute: ({ path, section }) => modelText(brainClient().read(path, section)),
    toModelOutput: compact,
  }),
  brain_write: tool({
    description:
      "Create, append, or replace (whole text) a Brain note in any folder, rule files included. A new note needs tags, status, date, and herkunft frontmatter.",
    inputSchema: z.object({
      path: z.string(),
      content: z.string(),
      mode: z.enum(["create", "append", "replace"]),
    }),
    execute: ({ path, content, mode }) =>
      modelText(brainClient().write(path, content, mode)),
    toModelOutput: compact,
  }),
  brain_move: tool({
    description:
      "Rename or move a Brain note. To delete a note, leave out to: it moves to 06 Archiv.",
    inputSchema: z.object({ from: z.string(), to: z.string().optional() }),
    execute: ({ from, to }) => modelText(brainClient().move(from, to)),
    toModelOutput: compact,
  }),
}
