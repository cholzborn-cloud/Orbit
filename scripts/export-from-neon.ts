import { neon } from "@neondatabase/serverless"

import {
  exportTables,
  importNeon,
  type NeonExport,
} from "../lib/db/import-neon.ts"

// Bewusst kein automatisches Laden der alten .env.local und keine Ausgabe von Verbindungsdaten.
async function main() {
  const url = process.env.NEON_EXPORT_DATABASE_URL
  const userId = process.env.NEON_EXPORT_USER_ID
  if (!url || !userId)
    throw new Error("NEON_EXPORT_DATABASE_URL und NEON_EXPORT_USER_ID fehlen.")
  const source = neon(url)
  // Alle Remote-Anweisungen sind SELECTs; readOnly schützt zusätzlich auf PostgreSQL-Ebene.
  const results = await source.transaction(
    exportTables.map((table) =>
      table === "bot_connectors"
        ? source.query(
            `select bc.* from bot_connectors bc
            join bots b on b.id = bc.bot_id
            join mcp_connectors c on c.id = bc.connector_id
            where b.user_id = $1 and c.user_id = $1`,
            [userId]
          )
        : source.query(`select * from "${table}" where user_id = $1`, [userId])
    ),
    { readOnly: true, isolationLevel: "RepeatableRead" }
  )
  const data = Object.fromEntries(
    exportTables.map((table, i) => [table, results[i]])
  ) as NeonExport
  const { getDatabase } = await import("../lib/db/client.ts")
  const db = getDatabase()
  try {
    const counts = importNeon(db.$client, data)
    for (const table of exportTables) console.log(`${table}: ${counts[table]}`)
    console.log("Lokaler Import abgeschlossen; kein Chat-Verlauf übernommen.")
  } finally {
    db.$client.close()
  }
}

main().catch(() => {
  console.error(
    "Export fehlgeschlagen. Verbindung, Quellnutzer und leere lokale Zieldatenbank prüfen. Es wurden keine Zugangsdaten ausgegeben."
  )
  process.exitCode = 1
})
