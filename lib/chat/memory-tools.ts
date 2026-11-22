import { tool, type ToolSet } from "ai"
import type Database from "better-sqlite3"
import { z } from "zod"

import { getDatabase } from "@/lib/db/client"
import {
  clearScratchpad,
  forgetEntry,
  getEntry,
  getScratchpad,
  listEntries,
  MEMORY_FROM,
  MEMORY_TYPES,
  saveEntry,
  setScratchpad,
} from "@/lib/orbi/local-memory"

// Lokales Gedächtnis des Orbis (Lauf H). Gruppenchats bekommen nur memory_get: geschrieben wird im 1:1-Chat.
export function memoryTools(
  botId: string,
  options: { readOnly?: boolean; db?: () => Database.Database } = {}
): ToolSet {
  const db = options.db ?? (() => getDatabase().$client)
  const get = tool({
    description:
      "Read one of your memory entries by name (with its version), or list all entries when name is empty.",
    inputSchema: z.object({
      name: z.string().optional().describe("Entry name from the memory index; empty lists all"),
    }),
    execute: async ({ name }) => {
      try {
        if (!name?.trim())
          return {
            entries: listEntries(db(), botId).map((e) => ({
              name: e.name,
              type: e.type,
              description: e.description,
              stated: e.stated,
              version: e.version,
              date: new Date(e.updatedAt).toISOString().slice(0, 10),
            })),
          }
        const entry = getEntry(db(), botId, name.trim())
        if (!entry) return { error: "Entry not found." }
        return {
          name: entry.name,
          type: entry.type,
          description: entry.description,
          body: entry.body,
          stated: entry.stated,
          from: entry.origin,
          source: entry.source,
          version: entry.version,
          date: new Date(entry.updatedAt).toISOString().slice(0, 10),
        }
      } catch {
        return { error: "Memory could not be read." }
      }
    },
  })
  if (options.readOnly) return { memory_get: get, ...scratchpadTool(botId, options) }
  return {
    memory_get: get,
    ...scratchpadTool(botId, options),
    memory_save: tool({
      description:
        "Save one small lasting fact. Only what Consti said (from=consti, quote in source) and true a month from now. Never secrets. Replace old entries via replaces.",
      inputSchema: z.object({
        name: z.string().describe("kebab-case, one subject per entry"),
        type: z.enum(MEMORY_TYPES).describe("user, feedback (Consti's rule), project, reference"),
        description: z.string().describe("One line, max 150 characters, shown in the index"),
        body: z.string().describe("The fact with its reason, max 1200 characters"),
        from: z.enum(MEMORY_FROM).describe("consti = he said it; self = your note; external = web, mail, file"),
        source: z.string().describe("Consti's words or where it came from"),
        ifVersion: z.number().int().optional().describe("Version from memory_get when changing an entry"),
        replaces: z.array(z.string()).optional().describe("Names of older entries this one replaces"),
      }),
      execute: async (input) => {
        try {
          return saveEntry(db(), botId, input)
        } catch {
          return { ok: false, error: "Memory could not be updated." }
        }
      },
    }),
    memory_forget: tool({
      description: "Delete one memory entry that is wrong or outdated, or when Consti asks to forget it.",
      inputSchema: z.object({ name: z.string().describe("Entry name from the memory index") }),
      execute: async ({ name }) => {
        try {
          return forgetEntry(db(), botId, name.trim())
        } catch {
          return { ok: false, error: "Memory could not be updated." }
        }
      },
    }),
  }
}

export function scratchpadTool(
  botId: string,
  options: { readOnly?: boolean; db?: () => Database.Database } = {}
): ToolSet {
  const db = options.db ?? (() => getDatabase().$client)
  return {
    scratchpad: tool({
      description:
        "Read, update or clear your working scratchpad for open tasks, temporary notes and follow-up routine IDs.",
      inputSchema: z.object({
        action: z
          .enum(["read", "write", "clear"])
          .describe("read = view current notes, write = save notes, clear = delete notes"),
        content: z
          .string()
          .max(4000)
          .optional()
          .describe("Notes to store when action is write"),
      }),
      execute: async ({ action, content }) => {
        try {
          const sqlite = db()
          if (action === "read") {
            const current = getScratchpad(sqlite, botId)
            return { ok: true, scratchpad: current || "(empty)" }
          }
          if (options.readOnly) {
            return { ok: false, error: "Scratchpad is read-only in group chats." }
          }
          if (action === "clear") {
            clearScratchpad(sqlite, botId)
            return { ok: true, message: "Scratchpad cleared." }
          }
          if (action === "write") {
            const res = setScratchpad(sqlite, botId, content ?? "")
            return res.ok ? { ok: true, message: "Scratchpad updated." } : res
          }
          return { ok: false, error: "Invalid action." }
        } catch {
          return { ok: false, error: "Scratchpad could not be updated." }
        }
      },
    }),
  }
}
