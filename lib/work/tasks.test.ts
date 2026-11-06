import assert from "node:assert/strict"
import test from "node:test"

import { openDatabase } from "../db/client.ts"
import {
  countActiveTasks,
  createTask,
  finishTask,
  getActiveTasks,
  getTask,
  listTasks,
  setTaskStatus,
  stopAllTasks,
  stopTask,
  stopTasksForOrbi,
  updateTaskProgress,
} from "./tasks.ts"
import { clearCompletedTodos, listTodos, writeTodos } from "./todos.ts"

function createTestDb() {
  const db = openDatabase(":memory:")
  const sqlite = db.$client
  sqlite
    .prepare(
      `INSERT INTO bots (id, user_id, third_party_id, name, avatar, job)
       VALUES ('bot-1', 'local', 'tp-1', 'Freddy', 'bot', 'Assistant'),
              ('bot-2', 'local', 'tp-2', 'Rex', 'bot', 'Researcher')`
    )
    .run()
  sqlite
    .prepare(
      `INSERT INTO chats (id, user_id, kind, name)
       VALUES ('chat-1', 'local', 'direct', 'Chat 1'),
              ('chat-2', 'local', 'direct', 'Chat 2')`
    )
    .run()
  return sqlite
}

test("Tasks: CRUD, Statuswechsel, Fortschritt und Stopp", () => {
  const db = createTestDb()

  // 1. Task anlegen
  const task = createTask(db, {
    orbiId: "bot-1",
    parentChatId: "chat-1",
    brief: "Recherchiere die Release Notes von Node 24",
    title: "Node 24 Recherche",
    mode: "work",
    reply: "resume",
    status: "running",
  })
  assert.equal(task.brief, "Recherchiere die Release Notes von Node 24")
  assert.equal(task.title, "Node 24 Recherche")
  assert.equal(task.status, "running")
  assert.equal(task.mode, "work")
  assert.equal(task.reply, "resume")
  assert.ok(task.startedAt)

  // 2. getTask
  const fetched = getTask(db, task.id)
  assert.deepEqual(fetched, task)

  // 3. Fortschritt aktualisieren
  const okProgress = updateTaskProgress(db, task.id, "5 von 10 Seiten gelesen")
  assert.equal(okProgress, true)
  const withProgress = getTask(db, task.id)
  assert.equal(withProgress?.progress, "5 von 10 Seiten gelesen")
  assert.ok(withProgress?.lastProgressAt)

  // 4. listTasks Filter
  const listRunning = listTasks(db, { status: "running" })
  assert.equal(listRunning.length, 1)
  assert.equal(listRunning[0].id, task.id)

  const listEmpty = listTasks(db, { orbiId: "bot-2" })
  assert.equal(listEmpty.length, 0)

  // 5. Zähler aktive Tasks
  assert.equal(countActiveTasks(db, "bot-1"), 1)
  assert.equal(countActiveTasks(db, "bot-2"), 0)
  assert.equal(getActiveTasks(db, "bot-1").length, 1)

  // 6. finishTask
  const okFinish = finishTask(
    db,
    task.id,
    "done",
    "Node 24 hat verbesserte Performance."
  )
  assert.equal(okFinish, true)
  const finished = getTask(db, task.id)
  assert.equal(finished?.status, "done")
  assert.equal(finished?.result, "Node 24 hat verbesserte Performance.")
  assert.ok(finished?.finishedAt)
  assert.equal(countActiveTasks(db, "bot-1"), 0)

  // 7. Resume-Task
  const resumed = createTask(db, {
    orbiId: "bot-1",
    parentChatId: "chat-1",
    brief: "Vertiefe den Abschnitt über V8",
    resumeOf: task.id,
    status: "running",
  })
  assert.equal(resumed.resumeOf, task.id)

  // 8. Stoppen
  const okStop = stopTask(db, resumed.id, "Nutzerabbruch")
  assert.equal(okStop, true)
  const stopped = getTask(db, resumed.id)
  assert.equal(stopped?.status, "stopped")
  assert.ok(stopped?.result?.includes("stopped"))

  // 9. Mehrere Tasks und stopTasksForOrbi / stopAllTasks
  createTask(db, {
    orbiId: "bot-1",
    parentChatId: "chat-1",
    brief: "Aufgabe A",
    status: "running",
  })
  createTask(db, {
    orbiId: "bot-1",
    parentChatId: "chat-1",
    brief: "Aufgabe B",
    status: "running",
  })
  assert.equal(countActiveTasks(db, "bot-1"), 2)

  const stoppedIds = stopTasksForOrbi(db, "bot-1")
  assert.equal(stoppedIds.length, 2)
  assert.equal(countActiveTasks(db, "bot-1"), 0)

  createTask(db, {
    orbiId: "bot-2",
    parentChatId: "chat-2",
    brief: "Aufgabe C",
    status: "running",
  })
  assert.equal(countActiveTasks(db, "bot-2"), 1)
  const allStopped = stopAllTasks(db)
  assert.equal(allStopped.length, 1)
  assert.equal(countActiveTasks(db, "bot-2"), 0)

  db.close()
})

test("Todos: Schreiben, Lesen und Aufräumen", () => {
  const db = createTestDb()

  const items = [
    { content: "Schritt 1 vorbereiten", status: "done" as const },
    { content: "Schritt 2 ausführen", status: "in_progress" as const },
    { content: "Schritt 3 testen", status: "todo" as const },
  ]

  const written = writeTodos(db, "chat-1", "bot-1", items)
  assert.equal(written.length, 3)
  assert.equal(written[0].content, "Schritt 1 vorbereiten")
  assert.equal(written[0].status, "done")
  assert.equal(written[1].status, "in_progress")
  assert.equal(written[2].status, "todo")

  // Update existing item
  const update = writeTodos(db, "chat-1", "bot-1", [
    { id: written[1].id, content: "Schritt 2 abgeschlossen", status: "done" },
  ])
  const foundUpdated = update.find((t) => t.id === written[1].id)
  assert.equal(foundUpdated?.content, "Schritt 2 abgeschlossen")
  assert.equal(foundUpdated?.status, "done")

  // List todos
  const list = listTodos(db, "chat-1")
  assert.equal(list.length, 3)

  // Clear completed
  const cleared = clearCompletedTodos(db, "chat-1")
  assert.equal(cleared, 2)
  const remaining = listTodos(db, "chat-1")
  assert.equal(remaining.length, 1)
  assert.equal(remaining[0].status, "todo")

  db.close()
})
