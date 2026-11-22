import { decryptConnectorAuth } from "@/lib/connectors/crypto"
import {
  connectorTools,
  unavailableConnectorTool,
  type Connector,
} from "@/lib/connectors/client"
import { oauthAccessToken, type OAuthStore } from "@/lib/connectors/oauth"
import type { ToolSet } from "ai"
import { defaultSql } from "@/lib/chat/load-chat"
import type { ChatContext } from "@/lib/chat/load-chat"
import { vaultOAuthStore } from "@/lib/marketplace/oauth-vault-store"
import { vault } from "@/lib/marketplace/vault"

const sqlStore = (
  sql: NonNullable<ReturnType<typeof defaultSql>>,
  id: string,
  userId: string
): OAuthStore => ({
  load: async () =>
    (
      (await sql`select oauth_encrypted from mcp_connectors where id = ${id} and user_id = ${userId}`) as {
        oauth_encrypted: string | null
      }[]
    )[0]?.oauth_encrypted ?? null,
  save: async (value) => {
    await sql`update mcp_connectors set oauth_encrypted = ${value} where id = ${id} and user_id = ${userId}`
  },
})

export async function loadConnectorTools(ctx: ChatContext) {
  const sql = defaultSql()
  if (!sql) {
    console.error("Konnektoren: Datenbank nicht verfügbar.")
    return unavailableConnectorTool(
      { id: "system", name: "Konnektoren" },
      "Konnektoren konnten nicht geladen werden."
    )
  }
  try {
    const rows = (await sql`
      select c.id, c.name, c.url, c.auth_encrypted, c.auth_header, c.oauth_encrypted
      from mcp_connectors c
      where c.user_id = ${ctx.userId} and c.enabled = true
    `) as {
      id: string
      name: string
      url: string
      auth_encrypted: string | null
      auth_header: string | null
      oauth_encrypted: string | null
    }[]
    const connectors: Connector[] = []
    const unavailable: ToolSet[] = []
    for (const row of rows) {
      const token = row.auth_encrypted
        ? decryptConnectorAuth(row.auth_encrypted)
        : null
      if (token && !token.ok) {
        console.error("Konnektoren: Token konnte nicht entschlüsselt werden.")
        unavailable.push(
          unavailableConnectorTool(
            { id: row.id, name: row.name },
            `Konnektor ${row.name}: Zugang konnte nicht geladen werden.`
          )
        )
        continue
      }
      const bearer = token?.ok
        ? token.value
        : await oauthAccessToken(
            vaultOAuthStore(vault, row.id, sqlStore(sql, row.id, ctx.userId)),
            row.url
          )
      connectors.push({
        id: row.id,
        name: row.name,
        url: row.url,
        token: bearer,
        header: row.auth_header,
      })
    }
    return Object.assign(
      {},
      await connectorTools(connectors, ctx.isGroup),
      ...unavailable
    ) as ToolSet
  } catch {
    console.error("Konnektoren konnten im Chat nicht geladen werden.")
    return unavailableConnectorTool(
      { id: "system", name: "Konnektoren" },
      "Konnektoren konnten nicht geladen werden."
    )
  }
}
