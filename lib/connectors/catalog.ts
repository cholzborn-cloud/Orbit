import { z } from "zod"

import { RISK_REASONS } from "../approvals/risk.ts"

const catalogEntrySchema = z.discriminatedUnion("type", [
  z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    type: z.literal("mcp"),
    source: z.string(),
    risk: z.enum(["read", "write"]),
    permissions: z.string(),
    verified: z.boolean(),
    url: z.string().url(),
    // Freigabe je Werkzeug, wenn Name oder Annotation täuschen.
    ask: z.record(z.string(), z.enum(RISK_REASONS)).optional(),
    free: z.array(z.string()).optional(),
  }),
  z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    type: z.literal("skill"),
    source: z.string(),
    risk: z.enum(["read", "write"]),
    permissions: z.string(),
    verified: z.boolean(),
    skillName: z.string(),
    skillDescription: z.string(),
    skillBody: z.string(),
  }),
])

export const connectorCatalogSchema = z.array(catalogEntrySchema).min(1)
export type CatalogEntry = z.infer<typeof catalogEntrySchema>

export function parseConnectorCatalog(input: unknown) {
  return connectorCatalogSchema.safeParse(input)
}

// Override für installierte Konnektoren; die Verbindung zum Katalog ist die URL.
export function catalogOverride(entries: CatalogEntry[], url: string) {
  const entry = entries.find(
    (item) => item.type === "mcp" && item.url === url
  )
  return entry?.type === "mcp" && (entry.ask || entry.free)
    ? { ask: entry.ask, free: entry.free }
    : undefined
}
