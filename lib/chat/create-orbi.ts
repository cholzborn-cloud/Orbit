import { tool } from "ai"
import { z } from "zod"
import type { CreateResult, NewOrbi } from "./onboarding.ts"

export const CREATE_ORBI = "create_orbi"

export function createOrbiTool(deps: {
  avatars: readonly string[]
  takenAvatars: () => string[]
  create: (orbi: NewOrbi) => Promise<CreateResult>
  created: (list: { botId: string; chatId: string; name: string }[]) => void
}) {
  const createdAvatars = new Set<string>()
  return tool({
    description: "Creates one new Orbi only after Consti explicitly asked for it or approved the creation. This also creates its sandbox.",
    inputSchema: z.object({
      name: z.string().trim().min(1).max(40).describe("Name of the new Orbi"),
      job: z.string().trim().min(1).max(60).describe("Its task"),
    }),
    execute: async ({ name, job }) => {
      const avatar = deps.avatars.find(value => !createdAvatars.has(value) && !deps.takenAvatars().includes(value)) ?? deps.avatars[0]
      if (!avatar) return { ok: false as const, error: "Kein Avatar verfügbar." }
      const result = await deps.create({ name, job, color: null, avatar })
      if (!result.ok) return result
      createdAvatars.add(avatar)
      deps.created([{ botId: result.id, chatId: result.chatId, name }])
      return { ok: true as const, name }
    },
  })
}
