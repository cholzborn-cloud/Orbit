import { z } from "zod"

// Keine vom Browser gesetzten Übergabe-/Besitzerfelder im lokalen Turn.
// Unbekannte Felder (z. B. approvalMode älterer App-Versionen) fallen still weg.
export const localClientDataSchema = z.object({
  model: z.string(),
  effort: z.string().optional(),
  context: z.boolean().default(true),
  botId: z.string().optional(),
  // Consti hat das Modell dieses Chats ausdrücklich gewählt (nicht der Standard): geweckte Orbis übernehmen es.
  modelPinned: z.boolean().optional(),
  // Erster Turn eines neuen Orbis (Messages dürfen leer sein): der Orbi stellt sich vor und fragt 2-3 Dinge.
  onboarding: z.boolean().optional(),
  skill: z
    .object({ name: z.string(), source: z.enum(["orbit", "brain"]) })
    .optional(),
})
