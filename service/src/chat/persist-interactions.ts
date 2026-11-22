import type Database from "better-sqlite3"

import { loadInteractions, removeInteraction, saveInteraction } from "@/lib/work/store"

import type { InteractionDecision, PendingInteraction } from "../interactions"

// Speichert offene Freigaben/Rückfragen in der Datenbank (Tabelle pending_interactions); die Entscheidung einer wiederhergestellten Karte
// steht im selben JSON unter `_decision`.
export function interactionPersistence(getDb: () => Database.Database) {
  return {
    save(request: PendingInteraction, decision?: InteractionDecision) {
      saveInteraction(getDb(), {
        id: request.id,
        chatId: request.chatId,
        botId: request.botId,
        kind: request.kind,
        requestedAt: request.requestedAt,
        expiresAt: request.expiresAt,
        request: { ...request, ...(decision ? { _decision: decision } : {}) },
      })
    },
    remove(id: string) {
      removeInteraction(getDb(), id)
    },
  }
}

export function storedInteractions(getDb: () => Database.Database, now = Date.now()) {
  return loadInteractions(getDb(), now).map((row) => {
    const { _decision, ...request } = row.request as PendingInteraction & { _decision?: InteractionDecision }
    return { request: request as PendingInteraction, decision: _decision }
  })
}
