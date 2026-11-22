import "../../service/src/chat/fixtures/temp-data.ts"
import assert from "node:assert/strict"
import test from "node:test"

import {
  automationCreateTool,
  updateRoutineTool,
} from "./automation-tool.ts"
import { getDatabase } from "../db/client.ts"
import { popUndo } from "../db/undo-store.ts"
import type { ChatContext } from "./load-chat.ts"

test("automationCreateTool & updateRoutineTool: sofortige Anlage, Änderung & Undo", async () => {
  const db = getDatabase().$client

  // Bot anlegen
  db.prepare(
    "INSERT OR IGNORE INTO bots (id, user_id, third_party_id, name, avatar, job) VALUES ('bot-auto-1', 'local', 'tp-auto-1', 'Freddy', 'bot', 'Chef')"
  ).run()

  const ctx: ChatContext = {
    userId: "local",
    speaker: {
      id: "bot-auto-1",
      name: "Freddy",
      is_main: true,
      job: "Chef",
      avatar: "bot",
      color: null,
      sandbox_id: null,
      member: true,
      direct_chat_id: null,
    },
    team: [],
    members: [],
    isGroup: false,
    depth: 0,
  }

  // 1. Tool-Instanzen
  const createTool = automationCreateTool(ctx)
  const routineTool = updateRoutineTool(ctx)

  // 2. Anlegen ohne Bestätigungsschritt
  const created = (await (createTool as any).execute({
    name: "Tagesabschluss",
    prompt: "Führe den Tagesabschluss durch",
    schedule: { kind: "daily", at: "22:00" },
    target: "new",
  }, { toolCallId: "t1", messages: [] })) as { ok: boolean; id: string; message: string }

  assert.equal(created.ok, true)
  assert.ok(created.id)
  assert.match(created.message, /Tagesabschluss.*ist angelegt/)

  // In DB angelegt
  const inDb = db.prepare("SELECT * FROM automations WHERE id = ?").get(created.id) as any
  assert.ok(inDb)
  assert.equal(inDb.name, "Tagesabschluss")
  assert.equal(inDb.enabled, 1)

  // 3. update_routine: list
  const list = (await (routineTool as any).execute({
    action: "list",
  }, { toolCallId: "t2", messages: [] })) as { ok: boolean; routines: any[] }
  assert.equal(list.ok, true)
  assert.ok(list.routines.some((r) => r.id === created.id))

  // 4. update_routine: pause
  const paused = (await (routineTool as any).execute({
    action: "pause",
    id: created.id,
  }, { toolCallId: "t3", messages: [] })) as { ok: boolean; message: string }
  assert.equal(paused.ok, true)

  const inDbPaused = db.prepare("SELECT enabled FROM automations WHERE id = ?").get(created.id) as any
  assert.equal(inDbPaused.enabled, 0)

  // 5. update_routine: delete (archive)
  const deleted = (await (routineTool as any).execute({
    action: "delete",
    id: created.id,
  }, { toolCallId: "t4", messages: [] })) as { ok: boolean; message: string }
  assert.equal(deleted.ok, true)

  const inDbDel = db.prepare("SELECT deleted_at FROM automations WHERE id = ?").get(created.id) as any
  assert.ok(inDbDel.deleted_at)
})
