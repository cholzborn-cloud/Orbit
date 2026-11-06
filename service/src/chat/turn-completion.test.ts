import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import ts from "typescript"

// Den echten Callback ausführen, ohne Modelle, Konnektoren oder App-Daten zu laden.
const source = ts.createSourceFile(
  "turn.ts",
  readFileSync(new URL("./turn.ts", import.meta.url), "utf8"),
  ts.ScriptTarget.Latest,
  true
)
let callback: ts.ArrowFunction | undefined
function findCallback(node: ts.Node) {
  if (
    ts.isPropertyAssignment(node) &&
    node.name.getText(source) === "onEnd" &&
    ts.isArrowFunction(node.initializer)
  )
    callback = node.initializer
  ts.forEachChild(node, findCallback)
}
findCallback(source)
assert.ok(callback)

type EndEvent = { isAborted: boolean; outcome: { status: string }; messages?: unknown[] }
const completed: EndEvent = {
  isAborted: false,
  outcome: { status: "success" },
  messages: [],
}

function harness(save: (event: EndEvent) => Promise<void>) {
  const events: string[] = []
  const controller = new AbortController()
  const onAbort = () => events.push("abort")
  controller.signal.addEventListener("abort", onAbort)
  const dependencies = {
    signal: controller.signal,
    onAbort,
    chatId: "chat",
    runId: undefined, // Job-Eintrag (Phase 5): ohne Tracker nichts zu beenden
    clearWorking: async () => {
      events.push("clear")
    },
    touchChat: async () => {
      events.push("touch")
    },
    onFinish: save,
    runtime: {
      status: (_chat: string, _bot: string, status: string) => {
        events.push(status)
      },
    },
    ctx: { speaker: { id: "bot" } },
    maybeSummarize: async () => {
      events.push("summary") // nur mit Nachrichten über der Schwelle; hier nie aufgerufen
    },
    sql: {},
    messages: [],
    messagesForSummary: (_history: unknown[], finished: unknown[]) => finished,
    afterTurnIfDue: async () => {
      events.push("jev") // wird seit Lauf E nicht mehr aufgerufen
    },
    clientData: { model: "auto" },
    settings: { settings: { auto: true } },
    text: "",
  }
  const onEnd = new Function(
    ...Object.keys(dependencies),
    `return (${callback!.getText(source)})`
  )(...Object.values(dependencies)) as (event: EndEvent) => Promise<void>
  return { events, controller, onEnd }
}

test("fertig wartet auf gespeicherte Nachrichten und Dateieinträge, kein Jev-Aufruf mehr", async () => {
  let release!: () => void
  let saving!: () => void
  const started = new Promise<void>((resolve) => {
    saving = resolve
  })
  const persisted = new Promise<void>((resolve) => {
    release = resolve
  })
  const run = harness(async () => {
    saving()
    await persisted
    run.events.push("saved")
  })
  const finish = run.onEnd(completed)
  await started
  assert.deepEqual(run.events, ["clear", "touch"])
  release()
  await finish
  // Danach (nur bei Erfolg) stößt der Turn die Zusammenfassung an; sie prüft selbst die Schwelle.
  assert.deepEqual(run.events, ["clear", "touch", "saved", "fertig", "summary"])
  run.controller.abort()
  assert.equal(run.events.includes("abort"), false)
})

test("Speicherfehler meldet fehler, bleibt abgelehnt und startet Jev nicht", async () => {
  const error = new Error("save failed")
  const run = harness(async () => {
    throw error
  })
  await assert.rejects(run.onEnd(completed), (caught) => caught === error)
  assert.deepEqual(run.events, ["clear", "touch", "fehler"])
})

test("Abbruch und Modellfehler speichern vor ihrem Status und starten Jev nicht", async () => {
  for (const [event, status] of [
    [{ ...completed, isAborted: true }, "ruhig"],
    [{ ...completed, outcome: { status: "failed" } }, "fehler"],
  ] as const) {
    const run = harness(async () => {
      run.events.push("saved")
    })
    await run.onEnd(event)
    assert.deepEqual(run.events, ["clear", "touch", "saved", status])
  }
})
