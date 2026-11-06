import { getDatabase } from "@/lib/db/client"
import {
  archiveFleetBot,
  listFleetBots,
  proposeBotProfile,
  updateFleetBot,
} from "@/lib/chat/orbi-fleet-tools"
import { clearScratchpad, getScratchpad, setScratchpad } from "@/lib/orbi/local-memory"
import { runEvalSuite } from "@/evals/runner"
import { replyHabitsRubricV1 } from "@/evals/rubrics/reply-habits-v1"
import { delegationRubricV1 } from "@/evals/rubrics/delegation-v1"
import { silenceRubricV1 } from "@/evals/rubrics/silence-v1"
import type { EvalSample } from "@/evals/types"

// ---- Orbis Fleet Endpunkte (Phase F) ----
export function listOrbisRoute(query?: URLSearchParams) {
  const db = getDatabase().$client
  const orbis = listFleetBots(db, "local")
  return { ok: true, count: orbis.length, orbis }
}

export function getOrbiRoute(id: string) {
  const db = getDatabase().$client
  const orbis = listFleetBots(db, "local")
  const found = orbis.find((b) => b.id === id)
  if (!found) {
    return { ok: false, error: `Orbi ${id} nicht gefunden.` }
  }
  return { ok: true, orbi: found }
}

export function updateOrbiRoute(id: string, body?: unknown) {
  const db = getDatabase().$client
  const b = body && typeof body === "object" ? (body as Record<string, unknown>) : {}
  const expectedVersion = Number(b.expected_version ?? b.expectedVersion)

  if (!Number.isInteger(expectedVersion)) {
    return {
      ok: false,
      error: "expected_version ist erforderlich für die Versionsprüfung.",
    }
  }

  const res = updateFleetBot(db, {
    id,
    expected_version: expectedVersion,
    name: typeof b.name === "string" ? b.name : undefined,
    job: typeof b.job === "string" ? b.job : undefined,
    instructions: typeof b.instructions === "string" ? b.instructions : undefined,
    color: typeof b.color === "string" ? b.color : undefined,
  })

  return res
}

export function archiveOrbiRoute(id: string, body?: unknown) {
  const db = getDatabase().$client
  const b = body && typeof body === "object" ? (body as Record<string, unknown>) : {}
  const expectedVersion =
    b.expected_version !== undefined || b.expectedVersion !== undefined
      ? Number(b.expected_version ?? b.expectedVersion)
      : undefined

  const res = archiveFleetBot(db, {
    id,
    expected_version: expectedVersion,
  })

  return res
}

// ---- Scratchpad Endpunkte (Phase D) ----
export function getScratchpadRoute(botId: string) {
  const db = getDatabase().$client
  const content = getScratchpad(db, botId)
  return { ok: true, botId, scratchpad: content }
}

export function setScratchpadRoute(botId: string, body?: unknown) {
  const db = getDatabase().$client
  const b = body && typeof body === "object" ? (body as Record<string, unknown>) : {}
  const content = typeof b.content === "string" ? b.content : ""
  const res = setScratchpad(db, botId, content)
  return res.ok ? { ok: true, botId, scratchpad: content } : res
}

export function clearScratchpadRoute(botId: string) {
  const db = getDatabase().$client
  clearScratchpad(db, botId)
  return { ok: true, botId, cleared: true }
}

// ---- Evals Runner Endpunkt (Phase G) ----
export async function runEvalsRoute(body?: unknown) {
  const b = body && typeof body === "object" ? (body as Record<string, unknown>) : {}
  const samples = Array.isArray(b.samples)
    ? (b.samples as EvalSample[])
    : [
        {
          id: "demo-sample-1",
          input: "Wie spät ist es?",
          output: "Es ist 14:30 Uhr.",
        },
      ]

  const rubrics = [replyHabitsRubricV1, delegationRubricV1, silenceRubricV1]
  const report = await runEvalSuite(samples, rubrics)
  return { ok: true, report }
}
