import { createInsertSchema } from "drizzle-zod"
import { z } from "zod"

import { bots } from "./schema"

// Namen der alten Figuren (Planeten), der Dienst nimmt sie weiter an.
export const ORBIS = [
  "erdi", "marsi", "sati", "jupi", "mondi", "veni", "nepi", "urani", "pluti", "universi",
] as const

// Namen der Figuren der Mac-App (Strobi bis Dosi, nach den Vorlagen des Avatar-Labs). Die Web-Oberfläche kennt sie nicht und
// zeigt dafür eine der alten Figuren; der Dienst nimmt beide Listen an.
export const MAC_AVATARS = [
  "strobi", "freddy", "citrus", "nova", "grokbot", "sunee", "kirby", "cloudee",
  "cubee", "onee", "rauti", "trixi", "tropi", "mopsi", "dosi",
] as const

export const botLookSchema = z.object({
  eyes: z.enum(["round", "square", "triangle"]).optional(),
  accessory: z
    .enum(["none", "cap", "glasses", "sunglasses", "headphones"])
    .optional(),
  cheeks: z.boolean().optional(),
  gaze: z.number().min(0).max(1).optional(),
  reaction: z.number().min(0.04).max(0.4).optional(),
})

export const insertBotSchema = createInsertSchema(bots, {
  look: botLookSchema.nullable().optional(),
  name: (s) => s.trim().min(1, "Gib deinem Orbi einen Namen").max(40),
  job: (s) => s.trim().min(1, "Gib deinem Orbi eine Aufgabe").max(60),
  avatar: z.enum([...ORBIS, ...MAC_AVATARS]),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable(),
  instructions: (s) => s.trim().max(1000),
})

// Felder, die der Nutzer im Dialog ausfüllt. userId/thirdPartyId setzt der Server.
export const botFormSchema = insertBotSchema.pick({
  name: true,
  avatar: true,
  color: true,
  isMain: true,
  job: true,
  instructions: true,
  look: true,
})

export type BotFormValues = z.infer<typeof botFormSchema>
