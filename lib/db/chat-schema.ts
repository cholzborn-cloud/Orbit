import { z } from "zod"

export const groupFormSchema = z.object({
  name: z.string().trim().min(1, "Gib der Gruppe einen Namen").max(40),
  botIds: z.array(z.string()).min(1, "Wähle mindestens einen Orbi"),
})

export type GroupFormValues = z.infer<typeof groupFormSchema>
