"use server"

import "@/lib/forms/zod-de"

import { auth } from "@/lib/auth"
import { and, count, eq, sql } from "drizzle-orm"
import { nanoid } from "nanoid"
import { z } from "zod"

import { db } from "@/lib/db"
import { mcpConnectors, approvalRules } from "@/lib/db/schema"
import {
  decryptConnectorAuth,
  encryptConnectorAuth,
} from "@/lib/connectors/crypto"
import { listTools, validConnectorHeader } from "@/lib/connectors/client"
import { dbOAuthStore } from "@/lib/connectors/oauth-store"
import {
  dropOAuth,
  pendingOAuthStore,
  promotePendingOAuth,
  vaultOAuthStore,
} from "@/lib/marketplace/oauth-vault-store"
import { vault } from "@/lib/marketplace/vault"
import {
  oauthAccessToken,
  oauthConnected,
  startOAuth,
} from "@/lib/connectors/oauth"
import { guardConnectorUrl } from "@/lib/connectors/url-guard"
import {
  getConnector,
  listConnectors as queryConnectors,
} from "@/query/connectors"

const connectorId = z.string().min(1).max(100)
const nameSchema = z.string().trim().min(2).max(40)
const headerSchema = z
  .string()
  .trim()
  .max(40)
  .refine((value) => !value || validConnectorHeader(value), "Header ungültig")
  .optional()

// Schlüsselbund zuerst, alter SQLite-Wert nur zum Lesen.
const oauthStore = (userId: string, id: string) =>
  vaultOAuthStore(vault, id, dbOAuthStore(userId, id))

export async function listConnectors() {
  const { userId } = await auth()

  try {
    const rows = await queryConnectors(userId)
    // Tokens liegen im Schlüsselbund; der alte SQLite-Wert zählt nur als Rückfall (nur Verbindungsstatus, nie der Wert).
    const connectors = await Promise.all(
      rows.map(async ({ hasAuth, oauth, ...connector }) => ({
        ...connector,
        hasAuth: !!hasAuth,
        oauth: oauthConnected(
          await oauthStore(userId, connector.id).load().catch(() => oauth)
        ),
      }))
    )
    return { ok: true as const, connectors }
  } catch {
    return {
      ok: false as const,
      error: "Konnektoren konnten nicht geladen werden.",
    }
  }
}

export async function addConnector(input: unknown) {
  const { userId } = await auth()

  const parsed = z
    .object({
      name: nameSchema,
      url: z.string().min(1).max(2048),
      token: z.string().max(4096).optional(),
      header: headerSchema,
    })
    .safeParse(input)
  if (!parsed.success)
    return {
      ok: false as const,
      error: "Name, URL, Token oder Header sind ungültig.",
    }
  const guarded = await guardConnectorUrl(parsed.data.url)
  if (!guarded.ok) return { ok: false as const, error: guarded.error }
  try {
    const [existing] = await db
      .select({ total: count() })
      .from(mcpConnectors)
      .where(eq(mcpConnectors.userId, userId))
    if ((existing?.total ?? 0) >= 20)
      return {
        ok: false as const,
        error: "Du kannst höchstens 20 Konnektoren anlegen.",
      }
    const encrypted = parsed.data.token
      ? encryptConnectorAuth(parsed.data.token)
      : null
    if (encrypted && !encrypted.ok)
      return { ok: false as const, error: encrypted.error }
    const [connector] = await db
      .insert(mcpConnectors)
      .values({
        id: nanoid(),
        userId,
        name: parsed.data.name,
        url: guarded.value.toString(),
        authEncrypted: encrypted?.ok ? encrypted.value : null,
        authHeader: encrypted && parsed.data.header ? parsed.data.header : null,
      })
      .returning({
        id: mcpConnectors.id,
        name: mcpConnectors.name,
        url: mcpConnectors.url,
        enabled: mcpConnectors.enabled,
      })
    return {
      ok: true as const,
      connector: { ...connector, hasAuth: !!encrypted },
    }
  } catch {
    return {
      ok: false as const,
      error: "Konnektor konnte nicht gespeichert werden.",
    }
  }
}

export async function testConnector(input: unknown) {
  const { userId } = await auth()

  const parsed = connectorId.safeParse(input)
  if (!parsed.success)
    return { ok: false as const, error: "Konnektor-ID ist ungültig." }
  try {
    const connector = await getConnector(userId, parsed.data)
    if (!connector)
      return { ok: false as const, error: "Konnektor nicht gefunden." }
    const token = connector.authEncrypted
      ? decryptConnectorAuth(connector.authEncrypted)
      : null
    if (token && !token.ok) return { ok: false as const, error: token.error }
    const bearer = token?.ok
      ? token.value
      : await oauthAccessToken(oauthStore(userId, connector.id), connector.url)
    const tools = await listTools({
      id: connector.id,
      name: connector.name,
      url: connector.url,
      token: bearer,
      header: connector.authHeader,
    })
    if (!Array.isArray(tools)) return { ok: false as const, error: tools.error }
    return { ok: true as const, count: tools.length, tools }
  } catch {
    return {
      ok: false as const,
      error: "Konnektor konnte nicht getestet werden.",
    }
  }
}

export async function setConnectorEnabled(input: unknown) {
  const { userId } = await auth()

  const parsed = z
    .object({ id: connectorId, enabled: z.boolean() })
    .safeParse(input)
  if (!parsed.success)
    return { ok: false as const, error: "Konnektor-Daten sind ungültig." }
  try {
    const [row] = await db
      .update(mcpConnectors)
      .set({ enabled: parsed.data.enabled })
      .where(
        and(
          eq(mcpConnectors.id, parsed.data.id),
          eq(mcpConnectors.userId, userId)
        )
      )
      .returning({ id: mcpConnectors.id })
    return row
      ? { ok: true as const }
      : { ok: false as const, error: "Konnektor nicht gefunden." }
  } catch {
    return { ok: false as const, error: "Status konnte nicht geändert werden." }
  }
}

export async function deleteConnector(input: unknown) {
  const { userId } = await auth()

  const parsed = connectorId.safeParse(input)
  if (!parsed.success)
    return { ok: false as const, error: "Konnektor-ID ist ungültig." }
  try {
    const row = db.transaction((tx) => {
      const deleted = tx
        .delete(mcpConnectors)
        .where(
          and(
            eq(mcpConnectors.id, parsed.data),
            eq(mcpConnectors.userId, userId)
          )
        )
        .returning({ id: mcpConnectors.id })
        .get()
      if (deleted)
        tx.delete(approvalRules)
          .where(
            and(
              eq(approvalRules.userId, userId),
              sql`substr(${approvalRules.tool}, 1, ${("connector:" + deleted.id + ":").length}) = ${"connector:" + deleted.id + ":"}`
            )
          )
          .run()
      return deleted
    })
    return row
      ? { ok: true as const }
      : { ok: false as const, error: "Konnektor nicht gefunden." }
  } catch {
    return {
      ok: false as const,
      error: "Konnektor konnte nicht gelöscht werden.",
    }
  }
}

export async function updateConnectorAuth(input: unknown) {
  const { userId } = await auth()

  const parsed = z
    .object({
      id: connectorId,
      token: z.string().max(4096),
      header: headerSchema,
    })
    .safeParse(input)
  if (!parsed.success)
    return { ok: false as const, error: "Token oder Header sind ungültig." }
  const encrypted = parsed.data.token
    ? encryptConnectorAuth(parsed.data.token)
    : null
  if (encrypted && !encrypted.ok)
    return { ok: false as const, error: encrypted.error }
  try {
    const [row] = await db
      .update(mcpConnectors)
      .set({
        authEncrypted: encrypted?.ok ? encrypted.value : null,
        authHeader: encrypted && parsed.data.header ? parsed.data.header : null,
      })
      .where(
        and(
          eq(mcpConnectors.id, parsed.data.id),
          eq(mcpConnectors.userId, userId)
        )
      )
      .returning({ id: mcpConnectors.id })
    return row
      ? { ok: true as const, hasAuth: !!encrypted }
      : { ok: false as const, error: "Konnektor nicht gefunden." }
  } catch {
    return {
      ok: false as const,
      error: "Zugang konnte nicht gespeichert werden.",
    }
  }
}

export async function startConnectorOAuth(input: unknown) {
  const { userId } = await auth()

  const parsed = connectorId.safeParse(input)
  if (!parsed.success)
    return { ok: false as const, error: "Konnektor-ID ist ungültig." }
  try {
    const connector = await getConnector(userId, parsed.data)
    if (!connector)
      return { ok: false as const, error: "Konnektor nicht gefunden." }
    // Läuft auf einem Zwischenspeicher: bricht der Nutzer ab, bleibt eine bestehende Verbindung bestehen.
    const result = await startOAuth(
      pendingOAuthStore(vault, connector.id),
      connector.url
    )
    if (result.authorized) await promotePendingOAuth(vault, connector.id)
    return { ok: true as const, ...result }
  } catch {
    return {
      ok: false as const,
      error:
        "Dieser Server unterstützt keine Anmeldung im Browser. Nutze einen Token.",
    }
  }
}

export async function disconnectConnectorOAuth(input: unknown) {
  const { userId } = await auth()

  const parsed = connectorId.safeParse(input)
  if (!parsed.success)
    return { ok: false as const, error: "Konnektor-ID ist ungültig." }
  try {
    await dropOAuth(vault, parsed.data)
    await dbOAuthStore(userId, parsed.data).save(null)
    return { ok: true as const }
  } catch {
    return { ok: false as const, error: "Abmelden hat nicht geklappt." }
  }
}

export async function setAllConnectorsEnabled(input: unknown) {
  const { userId } = await auth()

  const parsed = z.boolean().safeParse(input)
  if (!parsed.success)
    return { ok: false as const, error: "Status ist ungültig." }
  try {
    await db
      .update(mcpConnectors)
      .set({ enabled: parsed.data })
      .where(eq(mcpConnectors.userId, userId))
    return { ok: true as const }
  } catch {
    return { ok: false as const, error: "Status konnte nicht geändert werden." }
  }
}
