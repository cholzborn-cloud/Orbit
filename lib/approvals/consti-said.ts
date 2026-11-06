import { asSchema, jsonSchema, type JSONSchema7, type Tool } from "ai"

export const CONSTI_SAID = "consti_said"

const DESCRIPTION =
  "Only if Consti explicitly asked for exactly this action in his last message: his exact words from that message. Otherwise leave out."

const withProperty = (schema: JSONSchema7): JSONSchema7 => ({
  ...schema,
  type: "object",
  properties: {
    ...(schema.properties ?? {}),
    [CONSTI_SAID]: { type: "string", description: DESCRIPTION },
  },
})

const split = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return { rest: value, said: undefined }
  const { [CONSTI_SAID]: said, ...rest } = value as Record<string, unknown>
  return { rest, said: typeof said === "string" ? said : undefined }
}

// Optionales Zitat-Feld für Werkzeuge, die fragen können; das Original sieht es nie.
export function withConstiSaid<T extends Tool>(original: T): T {
  const schema = asSchema(original.inputSchema)
  const inputSchema = jsonSchema(
    () => {
      const base = schema.jsonSchema
      return "then" in base
        ? Promise.resolve(base).then(withProperty)
        : withProperty(base)
    },
    {
      validate: async (value) => {
        const { rest, said } = split(value)
        if (!schema.validate) return { success: true, value: value as never }
        const result = await schema.validate(rest)
        return result.success && said !== undefined
          ? {
              success: true,
              value: { ...(result.value as object), [CONSTI_SAID]: said } as never,
            }
          : result
      },
    }
  )
  return {
    ...original,
    inputSchema,
    ...(original.execute && {
      execute: (input: unknown, options: unknown) =>
        original.execute!(split(input).rest as never, options as never),
    }),
  } as T
}
