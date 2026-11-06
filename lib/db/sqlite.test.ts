import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { join, resolve } from "node:path"
import { test } from "node:test"

// Jeder Testprozess bekommt eine eigene Datei; niemals die persönlichen App-Daten verwenden.
const directory = mkdtempSync(resolve(".orbit-test-"))
process.env.ORBIT_DATA_DIR = directory
const { openDatabase, getDatabase } = await import("./client.ts")
const defaultDb = getDatabase()
const { createSql } = await import("./sql.ts")
const { claimAutomation, createAutomationChat } =
  await import("./automations.ts")
const { importNeon, exportTables } = await import("./import-neon.ts")
const { searchMessagesIn } = await import("../search/messages.ts")
const { databasePath } = await import("./path.ts")

test("SQLite: Migrationen, WAL, Typen, Trigger, Rollback, lokale Übernahme und Automations-Claim", async () => {
  const db = openDatabase(join(directory, "test.sqlite"))
  const sqlite = db.$client
  const sql = createSql(sqlite)
  try {
    assert.equal(databasePath(), join(directory, "orbit.sqlite"))
    assert.equal(sqlite.pragma("journal_mode", { simple: true }), "wal")
    assert.equal(sqlite.pragma("foreign_keys", { simple: true }), 1)
    const reopened = openDatabase(join(directory, "test.sqlite"))
    reopened.$client.close()
    const tables = sqlite
      .prepare("select name from sqlite_master where type = 'table'")
      .all() as { name: string }[]
    assert.equal(
      tables.filter(
        (t) =>
          !t.name.startsWith("chat_messages_fts") &&
          t.name !== "__drizzle_migrations"
      ).length,
      37 // seit 0004 mit bot_files, 0005 turn_usage, 0006 message_reactions, 0007 chat_summaries und tool_outputs, 0008 orbi_memory (3), 0009 chat_model_state, orbi_dream, orbi_dream_runs, 0010 work_runs, pending_interactions, task_counters, orbi_memory_attempts, orbi_memory_trash, chat_seen, app_kv, orbi_heartbeat, 0011 tasks, todos, 0012 undo_actions
    )

    const data = Object.fromEntries(
      exportTables.map((table) => [table, []])
    ) as Parameters<typeof importNeon>[1]
    data.bots = [
      {
        id: "bot",
        user_id: "remote",
        third_party_id: "bot",
        name: "Test",
        avatar: "planet",
        job: "Helfer",
        is_main: true,
        created_at: "2026-10-21T10:00:00Z",
      },
    ]
    data.automations = [
      {
        id: "auto",
        user_id: "remote",
        bot_id: "bot",
        name: "Test",
        prompt: "Hallo",
        schedule: { kind: "daily", at: "12:00" },
        chat_id: "alter-chat",
      },
    ]
    data.user_settings = [
      { user_id: "remote", jev_auto: true, jev_handoff: false },
    ]
    const invalid = structuredClone(data)
    invalid.automations[0].bot_id = "unbekannt"
    assert.throws(() => importNeon(sqlite, invalid), /FOREIGN KEY/)
    assert.equal(
      (sqlite.prepare("select count(*) as n from bots").get() as { n: number })
        .n,
      0
    )
    assert.equal(importNeon(sqlite, data).bots, 1)
    assert.throws(() => importNeon(sqlite, data), /leer/)
    const [bot] = (await sql`select * from bots`) as {
      user_id: string
      is_main: boolean
      created_at: Date
    }[]
    assert.equal(bot.user_id, "local")
    assert.equal(bot.is_main, true)
    assert.equal(bot.created_at.toISOString(), "2026-10-21T10:00:00.000Z")
    const [automation] = (await sql`select * from automations`) as {
      schedule: unknown
      chat_id: string | null
    }[]
    assert.deepEqual(automation.schedule, { kind: "daily", at: "12:00" })
    assert.equal(automation.chat_id, null)
    const [chat] = (await sql`select id from chats`) as { id: string }[]
    await sql`insert into chat_messages_index (id, user_id, chat_id, role, body) values ('m', 'local', ${chat.id}, 'user', 'Grüße vom Mond')`
    assert.equal(searchMessagesIn(sqlite, "local", "Mond").length, 1)
    assert.equal(searchMessagesIn(sqlite, "fremd", "Mond").length, 0)
    assert.equal(searchMessagesIn(sqlite, "local", '" OR NEAR *').length, 0)
    assert.equal(searchMessagesIn(sqlite, "local", "!!!").length, 0)
    await sql`update chat_messages_index set body = 'Mars besucht' where id = 'm'`
    assert.equal(searchMessagesIn(sqlite, "local", "Mond").length, 0)
    assert.equal(
      searchMessagesIn(sqlite, "local", "Mars")[0].snippet,
      "<<Mars>> besucht"
    )
    assert.throws(
      () =>
        db.transaction(() => {
          sqlite
            .prepare(
              "update chat_messages_index set body = 'Venus' where id = 'm'"
            )
            .run()
          throw new Error("Rollback")
        }),
      /Rollback/
    )
    assert.equal(searchMessagesIn(sqlite, "local", "Mars").length, 1)
    await sql`delete from chats where id = ${chat.id}`
    assert.equal(searchMessagesIn(sqlite, "local", "Mars").length, 0)
    assert.throws(
      () =>
        sqlite
          .prepare(
            "insert into bots (id, user_id, third_party_id, name, job, avatar, is_main) values ('b2', 'local', 'b2', 'B', 'Job', 'x', 1)"
          )
          .run(),
      /UNIQUE/
    )

    // Claim-Helfer verwenden die reguläre lokale Verbindung, ebenfalls in diesem Testordner.
    importNeon(defaultDb.$client, data)
    const claimed = claimAutomation("auto", "manual", "run")
    assert.equal(claimed.length, 1)
    assert.equal(claimed[0].user_id, "local")
    assert.equal(claimAutomation("auto", "manual", "zweiter-lauf").length, 0)
    assert.equal(
      createAutomationChat("run", "hintergrund")[0].chatId,
      "hintergrund"
    )
    assert.equal(createAutomationChat("unbekannt", "fehlt").length, 0)
  } finally {
    sqlite.close()
    defaultDb.$client.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
