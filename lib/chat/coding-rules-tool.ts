import { tool } from "ai"
import { z } from "zod"

import { readRuleFile } from "../orbi/rule-files.ts"

export const READ_CODING_RULES = "read_coding_rules"

// Coding-Regeln nur bei Bedarf: spart Kontext in allen anderen Turns.
export function readCodingRulesTool() {
  return tool({
    description:
      "Returns CODING.md, the coding rules for Orbit. Call it once before you start any coding task.",
    inputSchema: z.object({}),
    execute: async () => {
      const text = readRuleFile("CODING.md")
      return text ? { text } : { error: "CODING.md ist nicht lesbar." }
    },
  })
}
