import { localSql } from "../db/sql.ts"

// Läuft im Trigger-Worker (kein "server-only"), und ohne @/-Importe, damit `node --test` es laden kann.

// Parametrisierte Abfragen; Tests können eine Attrappe übergeben.
export type Sql = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<unknown[]>

export function defaultSql(): Sql {
  return localSql
}

export type ChatBot = {
  id: string
  name: string
  job: string
  instructions: string | null
  is_main: boolean
  sandbox_id: string | null
  avatar: string
  color: string | null
  member: boolean // Mitglied dieses Chats
  direct_chat_id: string | null // eigener 1:1-Chat, dort landen Übergaben
  onboarding_done?: boolean // false = neuer Orbi, Onboarding steht noch aus
}

export type ClientData = {
  model: string
  effort?: string
  botId?: string
  handoffDepth?: number
  handoffPath?: string[]
  handoffFrom?: string
  handoffGroup?: string
  handoffId?: string
  // Auftrag = alles, was aus einer Nachricht von Consti entsteht; vom Dienst gesetzt (nie vom Browser).
  rootTaskId?: string
  rootChatId?: string // Chat, in dem Consti die auslösende Nachricht schrieb
  // Dieser Turn wurde durch eine Orbi-Nachricht (message), eine Antwort (reply) oder ein Weck-Ereignis geweckt.
  wake?: {
    kind:
      | "message"
      | "reply"
      | "first_run"
      | "event"
      | "routine"
      | "agent"
      | "task_done"
    linkIds?: string[]
    label?: string
    details?: string
  }
  // Turn einer Gruppenrunde (vom Dienst gesetzt): `marked` = per @ gerufen, `forced` = Nachlauf (muss antworten),
  // `byOrbi` = ausgelöst durch eine Orbi-Nachricht an die Gruppe (kein Wort von Consti).
  groupTurn?: { marked: boolean; forced?: boolean; byOrbi?: boolean }
  // Consti hat im Root-Chat ausdrücklich ein Modell gewählt: geweckte Orbis nutzen es (sonst ihr eigenes).
  modelPinned?: boolean
  // Nutzer-ID des übergebenden Orbis, vom Worker gesetzt; nur für Übergaben ohne Chat-Zeile maßgeblich.
  ownerId?: string
  // Nur Hintergrundautomation; persistente Zuordnung wird nach dem separaten M17-Schema-Gate aktiviert.
  automationRunId?: string
  // Automationslauf ohne Nutzer am Chat: keine Rückfragen, keine neuen Automationen.
  background?: boolean
  // Erster Turn eines neuen Orbis ohne Nutzer-Nachricht: Vorstellung, Fragekarte, Anweisung ergänzen (nur wenn sein Onboarding aussteht).
  onboarding?: boolean
}

// Alles, was ein Orbi in diesem Chat braucht.
export type ChatContext = {
  userId: string // Besitzer des Chats
  isGroup: boolean
  // Übergabe aus einer Gruppe: eigene Session ohne Chat-Zeile, Weitergaben bleiben ebenfalls unsichtbar.
  hidden: boolean
  speaker: ChatBot // antwortet auf die Nachricht
  members: ChatBot[]
  team: ChatBot[] // alle Orbis des Nutzers, mögliche Übergabeziele
  from?: ChatBot // hat diese Aufgabe übergeben
  depth: number // Übergaben in dieser Kette bisher
  clientData?: ClientData
  chatName?: string // Gruppenname
  // Je Ziel-Session nacheinander: eine Session verträgt nur einen Turn gleichzeitig.
  queue: Map<string, Promise<void>>
}

// Übergaben ohne eigenen 1:1-Chat laufen in einer Session ohne Chat-Zeile; nur der Worker legt solche Ids an.
const HANDOFF_PREFIX = "handoff-"
const NOT_OWN = "Chat gehört nicht zu diesem Konto."
export const handoffChatId = () => `${HANDOFF_PREFIX}${crypto.randomUUID()}`

// Alle Orbis des Nutzers; im Gruppenchat spricht der gewählte, sonst der Hauptbot bzw. der zuerst beigetretene.
// Wirft mit deutscher Meldung, wenn kein Orbi sprechen darf: still ohne Persona zu antworten wäre schlimmer.
export async function loadChat(
  chatId: string,
  clientData?: ClientData,
  sql = defaultSql()
): Promise<ChatContext> {
  if (!sql) throw new Error("Die Datenbank ist nicht eingerichtet.")
  const [chatRow] =
    (await sql`select kind, user_id, name from chats where id = ${chatId}`) as {
      kind: string
      user_id: string
      name: string | null
    }[]
  let userId: string
  if (chatRow) userId = chatRow.user_id
  else {
    // Browser-Sessions haben immer eine Chat-Zeile (actions/chat.ts prüft sie). Fehlt sie dort (Chat gelöscht),
    // darf die botId aus dem Browser nicht den Besitzer bestimmen.
    if (!chatId.startsWith(HANDOFF_PREFIX))
      throw new Error("Chat nicht gefunden.")
    const [bot] =
      (await sql`select user_id from bots where id = ${clientData?.botId ?? ""}`) as {
        user_id: string
      }[]
    if (!bot) throw new Error("Orbi nicht gefunden.")
    if (!clientData?.ownerId) throw new Error(NOT_OWN)
    userId = bot.user_id
  }
  if (clientData?.ownerId && clientData.ownerId !== userId)
    throw new Error(NOT_OWN)
  const team = (await sql`
    select b.id, b.name, b.job, b.instructions, b.is_main, b.sandbox_id, b.avatar, b.color, b.onboarding_done, m.bot_id is not null as member,
      (select c.id from chats c join chat_members cm on cm.chat_id = c.id
       where c.kind = 'direct' and cm.bot_id = b.id order by c.created_at limit 1) as direct_chat_id
    from bots b left join chat_members m on m.bot_id = b.id and m.chat_id = ${chatId}
    where b.user_id = ${userId}
    order by b.is_main desc, m.joined_at nulls last, b.created_at`) as ChatBot[]
  const members = chatRow
    ? team.filter((b) => b.member)
    : team.filter((b) => b.id === clientData?.botId)
  const speaker = members.find((b) => b.id === clientData?.botId) ?? members[0]
  if (!speaker) throw new Error("In diesem Chat ist kein Orbi Mitglied.")
  return {
    userId,
    isGroup: chatRow?.kind === "group" || members.length > 1,
    hidden: !chatRow,
    speaker,
    members,
    team,
    from: team.find((b) => b.id === clientData?.handoffFrom),
    depth: clientData?.handoffDepth ?? 0,
    clientData,
    chatName: chatRow?.name ?? undefined,
    queue: new Map(),
  }
}

// `tools` (vor dem Turn) und `run` brauchen denselben Stand. Das Tool-Objekt entsteht je Turn neu und wird
// dem run unverändert übergeben, daran hängt der Stand: einmal laden, nichts bleibt über Turns hängen.
const turnState = new WeakMap<object, ChatContext | Error>()

// Der SDK ruft `tools` beim Start einer Fortsetzung (Verlauf wiederherstellen) und gleich danach für den Turn auf:
// derselbe Turn, also kurz teilen. Nur Erfolge, und nach SAME_TURN_MS wird neu geladen (kein Stand über Turns).
const SAME_TURN_MS = 2000
const recent = new Map<string, { at: number; ctx: ChatContext }>()

async function loadShared(chatId: string, clientData?: ClientData, sql?: Sql) {
  const key = `${chatId}\n${JSON.stringify(clientData)}`
  const now = Date.now()
  const hit = recent.get(key)
  if (hit && now - hit.at < SAME_TURN_MS) return hit.ctx
  const ctx = await loadChat(chatId, clientData, sql)
  for (const [k, v] of recent) if (now - v.at >= SAME_TURN_MS) recent.delete(k)
  recent.set(key, { at: now, ctx })
  return ctx
}

// Für `tools`: wirft nie. Bei Fehler gibt es keine Tools; `run` wirft ihn über turnContext.
export async function loadTurn<T extends object>(
  chatId: string,
  clientData: ClientData | undefined,
  build: (ctx: ChatContext) => T,
  sql?: Sql
): Promise<T> {
  try {
    const ctx = await loadShared(chatId, clientData, sql)
    const tools = build(ctx)
    turnState.set(tools, ctx)
    return tools
  } catch (e) {
    const tools = {} as T
    turnState.set(tools, e instanceof Error ? e : new Error(String(e)))
    return tools
  }
}

// Für `run`: Stand aus `tools` oder Fehler; ohne beides (z. B. kein Resolver gelaufen) selbst laden.
export async function turnContext(
  tools: object,
  chatId: string,
  clientData?: ClientData,
  sql?: Sql
): Promise<ChatContext> {
  const state = turnState.get(tools)
  if (state instanceof Error) throw state
  return state ?? loadChat(chatId, clientData, sql)
}
