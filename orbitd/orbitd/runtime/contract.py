"""Vertrag zwischen Laufzeit, Werkzeug-Brücke und Kontext. Nur Formen und Regeln, keine Logik.

Wer baut was (jeder Teil in eigenen Dateien, gekoppelt NUR über das, was hier steht):
  Laufzeit   runtime/engine.py (Runtime), runtime/runner.py (Run), runtime/actors.py, runtime/recovery.py, routes/chat.py
  Brücke     tools/bridge.py (MCP + Freigabe-Tor), runtime/interactions.py (Karten), tools/core.py, routes/interactions.py
  Kontext    context.py (was ein Orbi je Zug zu lesen bekommt)

Alle Teile hängen an ctx.parts (app.Ctx): "runtime", "bridge", "interactions". boot.start() legt sie in dieser Reihenfolge an.
"""
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Protocol

# ---------------------------------------------------------------- feste Zahlen (eine Stelle)
MAX_PARALLEL_RUNS = 4          # Läufe gleichzeitig im ganzen Dienst
TURN_TOTAL_S = 60 * 60         # Gesamtzeit je Lauf (Warten auf Freigabe zählt nicht)
TURN_IDLE_S = 5 * 60           # Abbruch ohne Lebenszeichen (nicht während ein Werkzeug läuft)
APPROVAL_WAIT_S = 10 * 60      # so lange hält eine Freigabe den Werkzeug-Aufruf offen
INTERACTION_TTL_MS = 24 * 3600 * 1000
SAY_MAX_CHARS, SAY_PER_RUN = 300, 12  # Zwischenstände: lieber oft als lange Stille (Consti 20.11.2026)
SILENT = "[[still]]"           # Antwort eines Gruppenmitglieds, das nichts sagen will (wird nicht gespeichert)
REASONS = ("geld", "veroeffentlichen", "nachricht", "loeschen", "geheimnis", "system", "dauerhaft")
CARD_TOOLS = ("say", "ask_user", "react", "share_file", "automation_create", "create_orbi", "InstallPlugin")  # nur diese stehen als Teil im Verlauf


# ---------------------------------------------------------------- ein Lauf, wie ihn Werkzeuge sehen
class Run(Protocol):
    """Ein Zug eines Orbis in einem Chat (Zeile in work_runs). Die Laufzeit baut die Klasse, Werkzeuge nutzen nur das hier."""
    id: str                    # work_runs.id
    ctx: Any                   # app.Ctx (db, bus, cfg, parts)
    bot: dict                  # Zeile aus bots (id, name, avatar, color, is_main, …)
    chat_id: str
    chat_kind: str             # direct | group | automation
    message_id: str            # ID der Assistent-Nachricht dieses Laufs (start.messageId == gespeicherte ID)
    root: dict                 # {"chatId": …, "taskId": …}: Chat und Auftrag, aus dem die Arbeit stammt
    automation_id: str | None  # Routine, aus der der Zug stammt (sonst None)
    counters: dict             # frei für Werkzeuge (z. B. {"say": 2})
    from_orbi: bool            # True, wenn ein Postfach-Eintrag des Laufs payload.orbi trägt (Zug stammt von einem anderen Orbi)

    def card(self, tool: str, tool_call_id: str, input: dict, output: dict | None = None) -> None:
        """Karten-Teil `tool-<name>` in Strom und Verlauf: ohne output Zustand input-available, mit output output-available.
        Ein zweiter Aufruf mit derselben tool_call_id aktualisiert den Teil. Speichert sofort (überlebt kill -9)."""

    def step(self, tool_call_id: str, tool: str, label: str, state: str) -> None:
        """Live-Leiste: Ereignis `status-step` (state start|end) plus Zeile in run_events. label = echte Angabe, nie leer."""

    def set_waiting(self, waiting: bool) -> None:
        """Status `wartet` (offene Freigabe) bzw. zurück auf `arbeitet`; hält die Leerlauf-Uhr an."""


# ---------------------------------------------------------------- Werkzeuge
@dataclass
class Risk:
    """Ein Werkzeug-Aufruf, der eine Freigabe braucht."""
    reason: str                # einer aus REASONS
    approval_kind: str         # Schlüssel für „Immer erlauben“ (z. B. "mac_shell", "connector:gmail:GMAIL_SEND_EMAIL")
    text: str                  # deutscher Satz für die Karte
    detail: str | None = None  # mehrzeiliger Zusatz


@dataclass
class Tool:
    name: str
    description: str           # für das Modell (englisch oder deutsch, kurz)
    schema: dict               # JSON-Schema der Argumente (type: object)
    handler: Callable[[Run, dict], Awaitable[Any]]      # Ergebnis: dict/str; Fehler als web.Fail("deutscher Satz")
    label: Callable[[dict], str | None] | None = None   # Text der Live-Leiste aus den echten Argumenten; None = kein Schritt
    risk: Callable[[Run, dict], Risk | None] | None = None  # None = läuft ohne Karte
    groups: bool = True        # False = nur im 1:1-Chat verfügbar
    available: Callable[[Run], bool] | None = None      # z. B. nur wenn Mac-Zugriff an ist


TOOLS: dict[str, Tool] = {}


def foreign(run) -> bool:
    """Fremddaten im Lauf: Orbi-Nachricht, „untrusted“ (von außen, bleibt je Chat und Orbi) oder „eigen“ (Brain, Kalender, Dateien; nur dieser Lauf)."""
    counters = getattr(run, "counters", {})
    return bool(getattr(run, "from_orbi", False) or counters.get("untrusted") or counters.get("eigen"))


def tool(name: str, description: str, schema: dict, **options):
    """Registriert ein Werkzeug: `@tool("say", "…", {...}, label=lambda a: None)` über `async def say(run, args)`."""

    def register(handler):
        TOOLS[name] = Tool(name, description, schema, handler, **options)
        return handler

    return register


# ---------------------------------------------------------------- Karten (Freigaben, Rückfragen)
# PendingInteraction (JSON in pending_interactions.request, Ereignisse approval/question, GET /v1/approvals):
#   {id, kind: "approval"|"ask", chatId, botId, toolCallId, tool, input, requestedAt(ms), expiresAt(ms),
#    reason?, approvalKind?, text?, detail?, root?{chatId,taskId}, from?{id,name,avatar,color}, restored?, runId}
#
# interactions (ctx.parts["interactions"]) bietet:
#   list() -> list[dict]                                  alle offenen; restored=True, wenn der Lauf nicht mehr lebt
#   async gate(run, tool, args) -> None                   Freigabe-Tor vor einem riskanten Werkzeug: Regel deny -> Fail;
#                                                         Regel allow oder unverbrauchte Einmal-Freigabe -> weiter; sonst Karte
#                                                         und warten bis APPROVAL_WAIT_S. Abgelehnt -> Fail("Consti hat das abgelehnt.").
#                                                         Zeit um -> Fail mit Hinweis, dass die Karte offen bleibt und die Antwort später kommt.
#   ask(run, tool_call_id, questions) -> dict             Rückfrage OHNE zu blockieren: Karte anlegen, sofort {"asked": True, …} zurück
#   async decide(id, decision) -> None                    once|always|deny (HttpError 410/409 wie in der Schnittstelle)
#   async answer(id, body) -> None                        {"answers":[…]} oder {"skipped": true}
#   abort_for_run(run_id) / abort_for_chat(chat_id)       Karten hinfällig (Status aborted), z. B. bei Stopp
#   expire()                                              älter als 24 h -> Status expired
# Eine Antwort oder späte Entscheidung erreicht den Orbi als Postfach-Eintrag (kind "answer", payload {"text": …}).
# on_answer-Haken: interactions.handlers[prefix] = async fn(id, body) für Karten des Dienstes selbst (z. B. "missed:" = verpasste Routine).


# ---------------------------------------------------------------- Brücke
# bridge (ctx.parts["bridge"]) bietet:
#   register(run) -> str        Einmal-Token für diesen Lauf (nur im Speicher)
#   unregister(token)
#   url -> str                  http://127.0.0.1:<port>/mcp
# POST /mcp: JSON-RPC (initialize, notifications/*, ping, tools/list, tools/call), Authorization: Bearer <Lauf-Token>.
# tools/call: Werkzeug suchen -> risk? -> interactions.gate -> run.step(start) -> handler -> run.step(end)
#             -> Ergebnis durch context.cap_tool_output -> {"content":[{"type":"text","text":…}], "isError": bool}.


# ---------------------------------------------------------------- Laufzeit
# runtime (ctx.parts["runtime"]) bietet:
#   async submit(chat_id, body) -> Response          POST /turn: prüfen, Nutzer-Nachricht unter ihrer Client-ID speichern,
#                                                    Postfach füllen (Gruppe: je Mitglied ein Eintrag), Strom zurückgeben
#   stream(chat_id) -> Response | None               laufender Strom des Chats
#   async stop(chat_id) -> {"stopped": bool, "requeued": [str]}
#   async resume(chat_id, run_id, dismiss) -> None   „Weiter“ nach Neustart
#   interrupted(chat_id) -> dict | None              {runId, at, startedAt, steps}
#   status() -> dict                                 GET /v1/status
#   snapshot() -> dict                               für /v1/events
#   wake(bot_id=None)                                Worker wecken (None = alle mit Wartendem)
#   live_message_id(chat_id) -> str | None           ID der gerade entstehenden Antwort
#   after_run: list[async fn(run, outcome)]          Haken nach jedem Lauf (outcome: {"status": done|failed|stopped, "text": …})
#   async run_automation(automation_id, trigger) -> str


# ---------------------------------------------------------------- Kontext
# context.py bietet (reine Funktionen über ctx.db, ohne Netz):
#   system_prompt(ctx, bot, chat) -> str             STABIL je Orbi und Chat-Art (Cache!): keine Uhrzeit, kein Gedächtnis-Inhalt
#   turn_prompt(ctx, bot, chat, items, session_is_new) -> TurnContext
#                                                    items = Postfach-Einträge dieses Laufs (payload: {"messageId"?, "text"?, "clientData"?, …})
#   commit_turn(ctx, bot, chat, turn_context)        nach ERFOLGREICHEM Lauf: merkt, was der Orbi jetzt kennt (gescheitert = nächstes Mal erneut senden)
#   cap_tool_output(ctx, chat_id, tool, text) -> str  lange Ergebnisse kürzen, voll in tool_outputs ablegen
#   default_instructions() -> str                    Standard-Anleitung (Antwort-Stil aus Ziel 3a)
#   async summarize_if_needed(ctx, chat_id)          Hintergrund nach dem Lauf: rollende Zusammenfassung in chat_summaries
# Die Laufzeit stellt dafür ctx.parts["oneshot"] bereit: async fn(prompt: str, tier="small") -> str (ein Modellaufruf ohne Werkzeuge).
@dataclass
class TurnContext:
    text: str                  # der ganze Text dieses Zugs für die CLI
    state: dict                # undurchsichtig; geht unverändert an commit_turn
    stats: dict                # {"volatileChars", "historyChars", "summaryUsed"} für turn_usage


@dataclass
class Outcome:
    status: str                # done | failed | stopped
    text: str = ""             # Endtext des Orbis
    error: str | None = None
    extra: dict = field(default_factory=dict)

    def __getitem__(self, key: str):  # Haken dürfen outcome["status"] oder outcome.status schreiben
        return getattr(self, key)

    def get(self, key: str, default=None):
        return getattr(self, key, default)


# ---------------------------------------------------------------- Wave 1 shared work contract (frozen for waves 2A–2C)
# Schema: migrations/0016_work_contract.sql. Store: runtime/ledger.py. Changes need the lead and a new PROTOCOL_VERSION.
PROTOCOL_VERSION = 7           # equals SERVICE_GENERATION in orbit-app/src-tauri/src/profile.rs

# Integration rules for waves 2A–2C (binding):
# - deliveries is the only path from a model to a person. Every public assistant part in chat_messages comes from a
#   committed delivery: commit_delivery -> chatstore write / stream chunk -> mark_emitted. recovery.replay_deliveries
#   repairs a crash between commit and display. Raw final model text is private (stored as a 'report' for the parent).
#   Wired today: tools/core.py::say. 2A moves runner text and the final answer onto this path; 2B moves cards and files.
# - interactions.gate opens an effects row for every reviewed call and keeps pending_interactions as the card view
#   (request.effectId). Decision -> ledger.decide with the session principal; dispatch -> ledger.claim right before the
#   handler; outcome -> ledger.record. A changed payload -> ledger.revise and a fresh card.
# - approval_rules "always allow" stays for local, reversible device and workspace actions (decision 3). External
#   messages, purchases and payments, publication, credentials and account connection are one-off Word reviews: they
#   never match an "always" rule and need a decision per payload.
# - work_requests is written when a user message is accepted (before any dispatch). Its root_run_id is the first run.
#   Stop -> ledger.cancel_root. A request in a stopped state refuses late deliveries and effects of its tree.

# Engineering lanes (scheduling) and product roles (Word sections 2.1–2.8). Old rows without a role are "foreground".
LANES = ("interactive", "background")
ROLES = ("foreground", "executor", "readonly", "desktop", "device", "automation", "meeting", "team", "group")
DELIVERY_KINDS = ("text", "attachment", "widget", "memo", "reaction", "secret-request", "cloud-job", "report")
AUDIENCES = ("chat", "thread", "dm", "group", "channel", "meeting", "parent")
# Effect lifecycle. Only the transitions below are legal; every move is a compare-and-set on (status, version).
EFFECT_TRANSITIONS = {
    "draft": ("pending", "cancelled", "superseded", "expired"),
    "pending": ("approved", "denied", "expired", "cancelled", "interrupted", "superseded"),
    "interrupted": ("pending", "cancelled", "expired"),
    "approved": ("claimed", "expired", "cancelled", "interrupted"),  # a restart before dispatch asks again
    "claimed": ("dispatched", "unknown", "failed"),
    "unknown": ("done", "failed"),          # only after provider readback, never by blind retry
    "dispatched": ("done", "failed", "unknown"),
}
EFFECT_TERMINAL = ("done", "failed", "denied", "expired", "cancelled", "superseded")
ROOT_STOPPED = ("cancelled", "failed")  # a work request in these states refuses late child deliveries and effects


@dataclass
class WorkIdentity:
    """Who is working, for whom and where the result goes. Persisted on work_runs (0016 columns)."""
    run_id: str
    owner_bot_id: str          # the visible Orbi that owns the conversation
    origin_chat_id: str
    origin_message_id: str | None = None
    thread_root_id: str | None = None
    parent_run_id: str | None = None
    root_run_id: str | None = None
    role: str = "foreground"
    lane: str = "interactive"
    principal_id: str = "local"


@dataclass
class Delivery:
    """One model-to-user publication (Word SendToUser). Private deliveries are stored, never emitted."""
    client_key: str            # stable per (run, tool call, part); a replay with the same key is a no-op
    chat_id: str
    kind: str
    parts: list
    visibility: str = "public"
    audience: str = "chat"
    run_id: str | None = None
    root_run_id: str | None = None
    request_id: str | None = None
    thread_root_id: str | None = None
    channel: str | None = None
    recipient: str | None = None
    message_id: str | None = None
    artifacts: list = field(default_factory=list)
    end_turn: bool = False
