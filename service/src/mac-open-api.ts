import { randomUUID } from "node:crypto"

import { createSkill } from "@/actions/skills"
import { baseOrbiTools, promptLayers, systemPrompt, volatileContext } from "@/lib/chat/agent"
import { loadChat } from "@/lib/chat/load-chat"
import { getDatabase } from "@/lib/db/client"
import { AUTO_MODEL_ID } from "@/lib/jev/types"
import { restoreBotMemoryEntry } from "./memory-api"
import { undoMacAction, type MacUndo } from "../../lib/mac/tools.ts"

export type SkillProposal = {
  id: string
  name: string
  description: string
  body: string
  reason: string
  sourceChats?: string[]
  createdAt: number
}

const KV_PROPOSALS_KEY = "skill_proposals"

function readProposals(): SkillProposal[] {
  const db = getDatabase().$client
  const row = db
    .prepare("SELECT value FROM app_kv WHERE key = ?")
    .get(KV_PROPOSALS_KEY) as { value: string } | undefined
  if (!row) return []
  try {
    return JSON.parse(row.value) as SkillProposal[]
  } catch {
    return []
  }
}

function saveProposals(proposals: SkillProposal[]) {
  const db = getDatabase().$client
  const now = Date.now()
  db.prepare(
    `INSERT INTO app_kv (key, value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(KV_PROPOSALS_KEY, JSON.stringify(proposals), now)
}

// 1. Skill-Vorschläge
export function listSkillProposalsRoute() {
  const proposals = readProposals()
  return { ok: true, proposals }
}

export function createSkillProposalRoute(body?: unknown) {
  const b = body && typeof body === "object" ? (body as Record<string, unknown>) : {}
  const name = String(b.name ?? "").trim()
  const description = String(b.description ?? "").trim()
  const skillBody = String(b.body ?? "").trim()
  const reason = String(b.reason ?? "").trim()
  const sourceChats = Array.isArray(b.sourceChats)
    ? (b.sourceChats as string[])
    : []

  if (!name || !description || !skillBody) {
    return { ok: false, error: "Name, Beschreibung und Inhalt sind erforderlich." }
  }

  const proposal: SkillProposal = {
    id: randomUUID(),
    name,
    description,
    body: skillBody,
    reason,
    sourceChats,
    createdAt: Date.now(),
  }

  const proposals = readProposals()
  proposals.unshift(proposal)
  saveProposals(proposals)

  return { ok: true, id: proposal.id, proposal }
}

export async function acceptSkillProposalRoute(id: string, body?: unknown) {
  const proposals = readProposals()
  const index = proposals.findIndex((p) => p.id === id)
  if (index === -1) {
    return { ok: false, error: "Skill-Vorschlag nicht gefunden." }
  }
  const proposal = proposals[index]
  const b = body && typeof body === "object" ? (body as Record<string, unknown>) : {}
  const name = typeof b.name === "string" && b.name.trim() ? b.name.trim() : proposal.name
  const description =
    typeof b.description === "string" && b.description.trim()
      ? b.description.trim()
      : proposal.description
  const skillBody =
    typeof b.body === "string" && b.body.trim() ? b.body.trim() : proposal.body

  const created = await createSkill({
    name,
    description,
    body: skillBody,
  })

  if (!created.ok) {
    return created
  }

  proposals.splice(index, 1)
  saveProposals(proposals)

  return { ok: true, id, name, skillId: created.skill.id }
}

export function rejectSkillProposalRoute(id: string) {
  const proposals = readProposals()
  const index = proposals.findIndex((p) => p.id === id)
  if (index === -1) {
    return { ok: false, error: "Skill-Vorschlag nicht gefunden." }
  }
  proposals.splice(index, 1)
  saveProposals(proposals)
  return { ok: true, id }
}

// 2. Prompt-Vorschau
export async function promptPreviewRoute(chatId: string, query?: URLSearchParams) {
  try {
    const ctx = await loadChat(chatId, { ownerId: "local", model: AUTO_MODEL_ID })
    const tools = baseOrbiTools(ctx)
    const layers = promptLayers(ctx, tools)
    const fullPrompt = systemPrompt(ctx, tools)
    const volatile = volatileContext(ctx, tools)

    return {
      ok: true,
      chatId,
      bot: {
        id: ctx.speaker.id,
        name: ctx.speaker.name,
        job: ctx.speaker.job,
        isMain: ctx.speaker.is_main,
      },
      layers: {
        layer1Stable: layers.layer1Stable,
        layer2Tools: layers.layer2Tools,
        layer3Volatile: volatile,
      },
      sections: layers.sections,
      fullPrompt,
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Chat konnte nicht geladen werden.",
    }
  }
}

import { listUndo, popUndo, type UndoKind } from "@/lib/db/undo-store"

// 3. Rückgängig (Undo)
export async function undoRoute(body?: unknown) {
  const db = getDatabase().$client
  const b = body && typeof body === "object" ? (body as Record<string, unknown>) : {}
  const kind = typeof b.kind === "string" ? b.kind : "last"
  const orbiId = typeof b.orbiId === "string" ? b.orbiId : undefined

  // 1. Erst in allgemeinen Undo-Aktionen suchen (Routinen, Orbis, Profile)
  // Lokale Mac-Aktionen (lib/mac): nur mit Ziel (undoId), nie „die letzte irgendeiner Art“.
  if (kind === "mac") {
    if (!orbiId) return { ok: false, error: "Ziel fehlt." }
    const action = popUndo(db, { kind: "mac", entityId: orbiId })
    if (!action?.previousState) return { ok: false, error: "Nichts zum Rückgängigmachen gefunden." }
    try {
      const detail = await undoMacAction(JSON.parse(action.previousState) as MacUndo)
      return { ok: true, undone: "mac", detail, entityId: orbiId }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Rückgängig fehlgeschlagen." }
    }
  }
  if (kind === "routine" || kind === "orbi" || kind === "profile" || kind === "last") {
    const action = popUndo(db, {
      kind: kind === "last" ? undefined : (kind as UndoKind),
      entityId: orbiId,
    })
    if (action) {
      const prev = action.previousState ? JSON.parse(action.previousState) : null
      if (action.kind === "mac") {
        const detail = await undoMacAction(prev as MacUndo)
        return { ok: true, undone: "mac", detail, entityId: action.entityId }
      }

      if (action.kind === "routine") {
        if (action.action === "create") {
          db.prepare("UPDATE automations SET deleted_at = ? WHERE id = ?").run(Date.now(), action.entityId)
          return {
            ok: true,
            undone: "routine",
            detail: `Erstellung von Routine ${action.entityId} rückgängig gemacht (archiviert).`,
            entityId: action.entityId,
          }
        }
        if (action.action === "delete") {
          db.prepare("UPDATE automations SET deleted_at = NULL WHERE id = ?").run(action.entityId)
          return {
            ok: true,
            undone: "routine",
            detail: `Archivierte Routine ${action.entityId} wiederhergestellt.`,
            entityId: action.entityId,
          }
        }
        if (action.action === "pause" || action.action === "resume") {
          const enabled = prev?.enabled ?? true
          db.prepare("UPDATE automations SET enabled = ? WHERE id = ?").run(enabled ? 1 : 0, action.entityId)
          return {
            ok: true,
            undone: "routine",
            detail: `Statusänderung von Routine ${action.entityId} rückgängig gemacht.`,
            entityId: action.entityId,
          }
        }
        if (action.action === "update" && prev) {
          db.prepare(
            `UPDATE automations
             SET name = ?, prompt = ?, schedule = ?, enabled = ?
             WHERE id = ?`
          ).run(
            prev.name,
            prev.prompt,
            typeof prev.schedule === "string" ? prev.schedule : JSON.stringify(prev.schedule),
            prev.enabled ? 1 : 0,
            action.entityId
          )
          return {
            ok: true,
            undone: "routine",
            detail: `Änderung an Routine ${action.entityId} rückgängig gemacht.`,
            entityId: action.entityId,
          }
        }
      }

      if (action.kind === "orbi" || action.kind === "profile") {
        if (action.action === "archive") {
          db.prepare("UPDATE bots SET archived_at = NULL, version = version + 1 WHERE id = ?").run(action.entityId)
          return {
            ok: true,
            undone: "orbi",
            detail: `Archivierung von Orbi ${action.entityId} rückgängig gemacht.`,
            entityId: action.entityId,
          }
        }
        if (action.action === "update" && prev) {
          db.prepare(
            `UPDATE bots
             SET name = coalesce(?, name), job = coalesce(?, job), instructions = coalesce(?, instructions), color = ?, version = version + 1
             WHERE id = ?`
          ).run(prev.name ?? null, prev.job ?? null, prev.instructions ?? null, prev.color ?? null, action.entityId)
          return {
            ok: true,
            undone: "orbi",
            detail: `Änderung an Orbi ${action.entityId} rückgängig gemacht.`,
            entityId: action.entityId,
          }
        }
      }

      return {
        ok: true,
        undone: action.kind,
        detail: `Aktion ${action.action} für ${action.kind} rückgängig gemacht.`,
        entityId: action.entityId,
      }
    }
  }

  // 2. Gedächtnis aus Papierkorb wiederherstellen
  if (kind === "memory" || kind === "last") {
    let query = "SELECT id, bot_id as botId, name FROM orbi_memory_trash"
    const params: unknown[] = []
    if (orbiId) {
      query += " WHERE bot_id = ?"
      params.push(orbiId)
    }
    query += " ORDER BY deleted_at DESC LIMIT 1"
    const trash = db.prepare(query).get(...params) as
      | { id: number; botId: string; name: string }
      | undefined
    if (trash) {
      const restored = await restoreBotMemoryEntry(trash.botId, trash.name)
      if (restored.ok) {
        return {
          ok: true,
          undone: "memory",
          detail: `Gedächtnis-Eintrag „${trash.name}“ für Orbi ${trash.botId} wiederhergestellt.`,
          name: trash.name,
          botId: trash.botId,
        }
      }
    }
  }

  return {
    ok: false,
    error: "Keine rückgängig zu machende Aktion gefunden.",
  }
}

export function undoHistoryRoute(query?: URLSearchParams) {
  const db = getDatabase().$client
  const actions = listUndo(db, 20)
  const trash = db
    .prepare(
      `SELECT id, bot_id as botId, name, deleted_at as deletedAt, reason
       FROM orbi_memory_trash
       ORDER BY deleted_at DESC
       LIMIT 20`
    )
    .all() as Array<{
    id: number
    botId: string
    name: string
    deletedAt: number
    reason: string | null
  }>

  const log = db
    .prepare(
      `SELECT id, bot_id as botId, name, action, version, at
       FROM orbi_memory_log
       ORDER BY at DESC
       LIMIT 20`
    )
    .all() as Array<{
    id: number
    botId: string
    name: string
    action: string
    version: number | null
    at: number
  }>

  return {
    ok: true,
    history: {
      actions,
      trash,
      log,
    },
  }
}
