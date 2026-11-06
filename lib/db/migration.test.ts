import assert from "node:assert/strict"
import { copyFileSync, existsSync, unlinkSync } from "node:fs"
import test from "node:test"

import Database from "better-sqlite3"

import { openDatabase } from "./client.ts"

const BACKUP_PATH =
  "/Users/constantinholzborn/Projekte-Coding/Backups/Orbit/2026-11-06_nacht/orbit.sqlite.bak"

test("Migration 0011: tasks und todos Tabelle werden auf Backup-DB angewendet und erhalten Daten", () => {
  if (!existsSync(BACKUP_PATH)) {
    // Falls Backup-Pfad nicht vorhanden, Test überspringen
    return
  }
  const tmpPath = `/tmp/orbit-migration-test-${Date.now()}.sqlite`
  try {
    copyFileSync(BACKUP_PATH, tmpPath)

    // Vorab-Prüfung der Daten
    const rawBefore = new Database(tmpPath, { readonly: true })
    const botsCountBefore = (
      rawBefore.prepare("SELECT count(*) as count FROM bots").get() as { count: number }
    ).count
    const chatsCountBefore = (
      rawBefore.prepare("SELECT count(*) as count FROM chats").get() as { count: number }
    ).count
    rawBefore.close()

    // Datenbank mit Migrator öffnen
    const db = openDatabase(tmpPath)

    // Prüfen, ob Migration 0012 eingetragen ist
    const sqlite = db.$client
    const applied = sqlite
      .prepare("SELECT * FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1")
      .get() as { id: number; created_at: number }
    assert.equal(applied.created_at, 1793900000000)

    // Vorhandene Daten noch da?
    const botsCountAfter = (
      sqlite.prepare("SELECT count(*) as count FROM bots").get() as { count: number }
    ).count
    const chatsCountAfter = (
      sqlite.prepare("SELECT count(*) as count FROM chats").get() as { count: number }
    ).count
    assert.equal(botsCountAfter, botsCountBefore)
    assert.equal(chatsCountAfter, chatsCountBefore)

    // Migration 0012: bots hat version und archived_at
    const sampleBot = sqlite.prepare("SELECT version, archived_at FROM bots LIMIT 1").get() as {
      version: number
      archived_at: number | null
    }
    assert.equal(sampleBot.version, 1)
    assert.equal(sampleBot.archived_at, null)

    // Neue Tabellen tasks, todos, undo_actions existieren
    const tables = (
      sqlite
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('tasks', 'todos', 'undo_actions')"
        )
        .all() as { name: string }[]
    ).map((t) => t.name)
    assert.ok(tables.includes("tasks"))
    assert.ok(tables.includes("todos"))
    assert.ok(tables.includes("undo_actions"))

    // Test-Insert in undo_actions
    sqlite
      .prepare(
        `INSERT INTO undo_actions (id, kind, entity_id, action, detail, previous_state)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run("undo-1", "orbi", "bot-test", "update", "Orbi Name geändert", JSON.stringify({ name: "Alt" }))
    const undoRow = sqlite.prepare("SELECT * FROM undo_actions WHERE id = ?").get("undo-1") as
      | { id: string; kind: string; detail: string }
      | undefined
    assert.equal(undoRow?.id, "undo-1")
    assert.equal(undoRow?.kind, "orbi")

    // Beispiel-Bot und Chat für Test-Insert
    const existingBot = sqlite.prepare("SELECT id FROM bots LIMIT 1").get() as
      | { id: string }
      | undefined
    const existingChat = sqlite.prepare("SELECT id FROM chats LIMIT 1").get() as
      | { id: string }
      | undefined
    if (existingBot && existingChat) {
      sqlite
        .prepare(
          `INSERT INTO tasks (id, orbi_id, parent_chat_id, brief, status, mode, reply)
           VALUES (?, ?, ?, ?, 'running', 'work', 'resume')`
        )
        .run("test-task-1", existingBot.id, existingChat.id, "Test brief")

      const task = sqlite.prepare("SELECT * FROM tasks WHERE id = ?").get("test-task-1") as
        | { id: string; status: string; brief: string; mode: string }
        | undefined
      assert.equal(task?.id, "test-task-1")
      assert.equal(task?.status, "running")
      assert.equal(task?.brief, "Test brief")

      sqlite
        .prepare(
          `INSERT INTO todos (id, chat_id, bot_id, content, status)
           VALUES (?, ?, ?, ?, 'todo')`
        )
        .run("test-todo-1", existingChat.id, existingBot.id, "Test todo item")

      const todo = sqlite.prepare("SELECT * FROM todos WHERE id = ?").get("test-todo-1") as
        | { id: string; content: string; status: string }
        | undefined
      assert.equal(todo?.id, "test-todo-1")
      assert.equal(todo?.content, "Test todo item")
      assert.equal(todo?.status, "todo")
    }

    sqlite.close()
  } finally {
    if (existsSync(tmpPath)) unlinkSync(tmpPath)
    // Auch evtl. von VACUUM INTO erzeugte .bak-Dateien in /tmp aufräumen
    for (const f of [
      `${tmpPath}-wal`,
      `${tmpPath}-shm`,
    ]) {
      if (existsSync(f)) unlinkSync(f)
    }
  }
})
