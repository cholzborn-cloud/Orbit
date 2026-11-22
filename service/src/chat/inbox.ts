import type Database from "better-sqlite3"

// Eingang je Chat (Lane-Prinzip wie bei OpenClaw: eine Hauptarbeit je Chat, alles andere wird gesammelt statt abgewiesen).
// Jede Nachricht, die Consti schreibt, während im Chat schon gearbeitet wird, landet hier und ist dauerhaft (app_kv), bis sie erledigt ist:
//  - `side`: sie wird sofort parallel beantwortet (Seitenlauf); die Antwort wird hier vermerkt.
//  - `queued`: kein Seitenlauf möglich (Gruppe, Neustart): sie wartet auf den nächsten Lauf.
// Die laufende Hauptarbeit holt sich neue Einträge an jeder Schrittgrenze (`takeForMain`) und berücksichtigt sie.
// Endet die Hauptarbeit, entscheidet `settle`, ob ein Folgelauf nötig ist: nur für Einträge, die weder die Hauptarbeit gesehen
// noch ein Seitenlauf beantwortet hat. So geht keine Nachricht verloren und nichts wird doppelt beantwortet.
export type InboxItem = {
  messageId: string
  text: string
  mode: "side" | "queued"
  at: number
  // Hauptarbeit hat den Eintrag an einer Schrittgrenze bekommen.
  seen?: boolean
  // Seitenlauf: läuft noch (`running`), beantwortet (`done`, mit Antworttext) oder gescheitert (`failed`).
  side?: "running" | "done" | "failed"
  reply?: string
  // Modell/Orbi-Wahl der App beim Senden: der Folgelauf nutzt sie.
  clientData?: unknown
}

export type InboxStorage = {
  load: (chatId: string) => InboxItem[]
  save: (chatId: string, items: InboxItem[]) => void
  chats: () => string[]
}

const PREFIX = "inbox:"

export function sqliteInboxStorage(db: () => Database.Database): InboxStorage {
  return {
    load(chatId) {
      try {
        const row = db().prepare("select value from app_kv where key = ?").get(PREFIX + chatId) as { value: string } | undefined
        const parsed = row ? JSON.parse(row.value) : []
        return Array.isArray(parsed) ? parsed : []
      } catch {
        return []
      }
    },
    save(chatId, items) {
      try {
        if (items.length === 0) db().prepare("delete from app_kv where key = ?").run(PREFIX + chatId)
        else
          db()
            .prepare("insert into app_kv (key, value, updated_at) values (?, ?, ?) on conflict(key) do update set value = excluded.value, updated_at = excluded.updated_at")
            .run(PREFIX + chatId, JSON.stringify(items), Date.now())
      } catch {
        console.error("Eingang konnte nicht gespeichert werden.")
      }
    },
    chats() {
      try {
        return (db().prepare("select key from app_kv where key like ?").all(PREFIX + "%") as { key: string }[]).map((row) => row.key.slice(PREFIX.length))
      } catch {
        return []
      }
    },
  }
}

export function memoryInboxStorage(): InboxStorage {
  const data = new Map<string, InboxItem[]>()
  return {
    load: (chatId) => structuredClone(data.get(chatId) ?? []),
    save: (chatId, items) => {
      if (items.length) data.set(chatId, structuredClone(items))
      else data.delete(chatId)
    },
    chats: () => [...data.keys()],
  }
}

export type SettleResult = {
  // Einträge, für die ein Folgelauf nötig ist (in Reihenfolge).
  followUp: InboxItem[]
  // Ein Seitenlauf ist noch nicht fertig: erst danach erneut entscheiden.
  pendingSide: boolean
}

export class Inbox {
  constructor(private readonly storage: InboxStorage) {}

  list(chatId: string): InboxItem[] {
    return this.storage.load(chatId)
  }

  chats(): string[] {
    return this.storage.chats()
  }

  add(chatId: string, item: Omit<InboxItem, "at"> & { at?: number }) {
    const items = this.storage.load(chatId).filter((entry) => entry.messageId !== item.messageId)
    items.push({ ...item, at: item.at ?? Date.now() })
    this.storage.save(chatId, items)
  }

  private update(chatId: string, messageId: string, patch: Partial<InboxItem>) {
    const items = this.storage.load(chatId)
    const item = items.find((entry) => entry.messageId === messageId)
    if (!item) return
    Object.assign(item, patch)
    this.storage.save(chatId, items)
  }

  sideFinished(chatId: string, messageId: string, result: { reply?: string; failed: boolean }) {
    this.update(chatId, messageId, result.failed ? { side: "failed" } : { side: "done", reply: result.reply?.slice(0, 2000) })
  }

  // Schrittgrenze der Hauptarbeit: alle noch nicht gesehenen Einträge (markiert sie als gesehen).
  takeForMain(chatId: string): InboxItem[] {
    const items = this.storage.load(chatId)
    const fresh = items.filter((item) => !item.seen)
    if (fresh.length === 0) return []
    for (const item of fresh) item.seen = true
    this.storage.save(chatId, items)
    return fresh
  }

  // Hauptarbeit zu Ende (oder kein Lauf mehr im Chat): was braucht noch einen Folgelauf?
  // Erledigt und entfernt werden: gesehene Einträge und beantwortete Seitenläufe. Folgelauf-Einträge entfernt erst `consume`.
  settle(chatId: string): SettleResult {
    const items = this.storage.load(chatId)
    const keep: InboxItem[] = []
    const followUp: InboxItem[] = []
    let pendingSide = false
    for (const item of items) {
      if (item.seen) continue
      if (item.mode === "side" && item.side === "running") {
        pendingSide = true
        keep.push(item)
        continue
      }
      if (item.mode === "side" && item.side === "done") continue
      followUp.push(item)
      keep.push(item)
    }
    this.storage.save(chatId, keep)
    return { followUp, pendingSide }
  }

  // Folgelauf gestartet: diese Einträge sind übergeben.
  consume(chatId: string, messageIds: string[]) {
    const ids = new Set(messageIds)
    this.storage.save(chatId, this.storage.load(chatId).filter((item) => !ids.has(item.messageId)))
  }

  // Stopp: wartende (nicht beantwortete, nicht gesehene) Einträge zurückgeben und entfernen.
  takeQueued(chatId: string): InboxItem[] {
    const items = this.storage.load(chatId)
    const queued = items.filter((item) => !item.seen && (item.mode === "queued" || item.side === "failed"))
    this.storage.save(chatId, items.filter((item) => !queued.includes(item)))
    return queued
  }

  clear(chatId: string) {
    this.storage.save(chatId, [])
  }
}

// Text, den die Hauptarbeit an der Schrittgrenze sieht (als Nutzernachricht, nie gespeichert). Er verankert die ursprüngliche Aufgabe:
// Live 09.11.2026 hielt das Modell eine Zwischenfrage („Wie lange dauert das?“) für den neuen Auftrag und brach seine Prüfung nach drei
// Schritten mit einer Zusammenfassung ab. Die Zwischenfrage ist schon beantwortet; die Aufgabe läuft vollständig weiter.
export function steeringText(items: InboxItem[], task?: string): string {
  const lines = items.map((item) => {
    const reply =
      item.mode === "side" && item.side === "done" && item.reply
        ? ` (bereits beantwortet: „${item.reply.slice(0, 300)}“)`
        : item.mode === "side" && item.side === "running"
          ? " (wird gerade parallel beantwortet)"
          : ""
    return `- „${item.text.slice(0, 2000)}“${reply}`
  })
  return [
    `Zwischennachricht von Consti während deiner Arbeit (kein neuer Auftrag):`,
    ...lines,
    ...(task?.trim() ? [`Deine Aufgabe bleibt: „${task.trim().slice(0, 1500)}“.`] : []),
    `Arbeite diese Aufgabe vollständig zu Ende, mit allen Schritten, die du ohnehin gemacht hättest. Kürze sie nicht ab und fasse nicht vorzeitig zusammen. Übernimm aus der Nachricht nur, was die Aufgabe ändert oder ergänzt (Korrektur, Wunsch, Abbruch). Bereits Beantwortetes nicht noch einmal beantworten.`,
  ].join("\n")
}
