"""Eingebaute Werkzeuge: say, ask_user, react, Gedächtnis, Routinen, Orbis anlegen. Vorlage: lib/chat/*.ts des alten Dienstes."""
from datetime import datetime, timezone

from .. import automations, memory, schedule
from ..db import new_id, now_ms
from ..runtime import contract, ledger
from ..runtime.contract import Risk, tool
from ..web import Fail, Req

REACTIONS = ["👍", "✅", "😂", "❤️", "👎", "🤔"]
TZ = "Europe/Berlin"
_text = {"type": "string"}
_no_background = lambda run: run.chat_kind != "automation" and not getattr(run, "automation_id", None)  # Hintergrundläufe dürfen nicht an Consti schreiben oder ihn fragen


# ------------------------------------------------------------ say, ask_user, react
@tool("say", "Send a short interim chat bubble RIGHT NOW. Call early and often on multi-step work: once before the first other tool, "
      "then again at each milestone (before slow tools, after big results). Prefer many short updates over silence. Not for the final answer.",
      {"type": "object", "properties": {"text": {"type": "string", "minLength": 1, "maxLength": contract.SAY_MAX_CHARS,
                                                 "description": "1 short sentence, max 300 characters; send immediately, don't wait"}},
       "required": ["text"]}, available=_no_background)
async def say(run, args):
    text = args["text"].strip()
    if not text:
        raise Fail("Leerer Text.")
    if run.counters.get("say", 0) >= contract.SAY_PER_RUN:
        raise Fail("Genug Zwischenstände – fass am Ende zusammen.")
    run.counters["say"] = n = run.counters.get("say", 0) + 1
    # Wave 1 slice: commit the delivery first, then show it, then mark it emitted. A restart in between replays it once.
    db = run.ctx.db
    try:
        row, _ = ledger.commit_delivery(db, contract.Delivery(
            client_key=f"{run.id}:say:{n}", chat_id=run.chat_id, kind="text", parts=[{"type": "text", "text": text}],
            run_id=run.id, root_run_id=(getattr(run, "root", None) or {}).get("taskId"), message_id=run.message_id))
    except ledger.LedgerError as e:
        raise Fail(str(e))
    if row["status"] == "committed":
        run.card("say", row["id"], {"text": text}, {"ok": True, "at": now_ms()})
        ledger.mark_emitted(db, row["id"])
    return "ok"


_option = {"type": "object", "properties": {
    "label": {"type": "string", "minLength": 1, "description": "Short answer, at most 5 words"},
    "description": {"type": "string", "description": "One short helpful line"},
    "recommended": {"type": "boolean", "description": "true for exactly one option: your recommendation"}}, "required": ["label"]}
_question = {"type": "object", "properties": {
    "question": {"type": "string", "minLength": 1, "description": "The question, one sentence"},
    "options": {"type": "array", "items": _option, "minItems": 2, "maxItems": 4},
    "multiple": {"type": "boolean", "description": "true if several answers may be chosen, default single choice"}}, "required": ["question", "options"]}


@tool("ask_user", "The ONLY way to ask Consti anything: every question goes here as a tappable card, never as a question in your reply text "
      "(no '?' in plain text, no 'Was genau soll ich prüfen?'). Before asking, check critically whether you can solve it yourself or make a sensible assumption; "
      "ask only when his decision is really needed (money, publishing, messages in his name, deletion, secrets, unclear goal). "
      "2-4 options, one recommended; bundle several questions into one call. The answer arrives later as a new message: keep working meanwhile.",
      {"type": "object", "properties": {"questions": {"type": "array", "items": _question, "minItems": 1, "maxItems": 4}},
       "required": ["questions"]}, available=_no_background)
async def ask_user(run, args):
    tool_call_id = new_id()
    for q in args["questions"]:  # die Empfehlung steht immer zuerst (stabile Sortierung) und trägt „(Empfehlung)“ im Label
        q["options"] = [{**o, "label": o["label"] if not o.get("recommended") or "(Empfehlung)" in o["label"] else o["label"].rstrip() + " (Empfehlung)"}
                        for o in sorted(q["options"], key=lambda o: not o.get("recommended"))]
    run.card("ask_user", tool_call_id, {"questions": args["questions"]})
    return run.ctx.parts["interactions"].ask(run, tool_call_id, args["questions"])


@tool("react", "React to a chat message with an emoji instead of text, e.g. thanks or a small chore done. A reaction alone can be the whole answer.",
      {"type": "object", "properties": {"emoji": {"enum": REACTIONS}, "message_id": {"type": "string", "description": "Default: Consti's last message"}},
       "required": ["emoji"]}, available=_no_background)
async def react(run, args):
    db = run.ctx.db
    message_id = args.get("message_id") or db.val("SELECT id FROM chat_messages WHERE chat_id=? AND role='user' ORDER BY position DESC LIMIT 1", run.chat_id)
    if not message_id or not db.val("SELECT 1 FROM chat_messages WHERE chat_id=? AND id=?", run.chat_id, message_id):
        raise Fail("Nachricht nicht gefunden.")
    actor = run.bot["id"]
    db.run("INSERT OR REPLACE INTO message_reactions (chat_id,message_id,actor,emoji,created_at) VALUES (?,?,?,?,?)", run.chat_id, message_id, actor, args["emoji"], now_ms())
    run.card("react", new_id(), {k: v for k, v in args.items() if k in ("emoji", "message_id")}, {"ok": True})
    run.ctx.bus.publish({"type": "reaction", "chatId": run.chat_id, "messageId": message_id, "actor": actor, "emoji": args["emoji"]})
    return "ok"


# ------------------------------------------------------------ Gedächtnis (Gruppen: nur lesen)
def _day(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, timezone.utc).strftime("%Y-%m-%d")


def _named(verb: str, empty: str):
    return lambda a: f"{verb} „{a['name'].strip()}“ …" if isinstance(a.get("name"), str) and a["name"].strip() else empty


@tool("memory_get", "Read one of your memory entries by name (with its version), or list all entries when name is empty.",
      {"type": "object", "properties": {"name": {"type": "string", "description": "Entry name from the memory index; empty lists all"}}},
      label=_named("Liest Gedächtnis", "Liest das Gedächtnis …"))
async def memory_get(run, args):
    name = (args.get("name") or "").strip()
    if not name:
        return {"entries": [{"name": e["name"], "type": e["type"], "description": e["description"], "stated": e["stated"],
                             "version": e["version"], "date": _day(e["updatedAt"])} for e in memory.list_entries(run.ctx.db, run.bot["id"])]}
    e = memory.get(run.ctx.db, run.bot["id"], name)
    if not e:
        raise Fail("Entry not found.")
    return {"name": e["name"], "type": e["type"], "description": e["description"], "body": e["body"], "stated": e["stated"],
            "from": e["origin"], "source": e["source"], "version": e["version"], "date": _day(e["updatedAt"])}


@tool("memory_save", "Save one small lasting fact. Only what Consti said (from=consti, quote in source) and true a month from now. "
      "Never secrets. Replace old entries via replaces.",
      {"type": "object", "properties": {
          "name": {"type": "string", "description": "kebab-case, one subject per entry"},
          "type": {"enum": list(memory.MEMORY_TYPES), "description": "user, feedback (Consti's rule), project, reference"},
          "description": {"type": "string", "description": "One line, max 150 characters, shown in the index"},
          "body": {"type": "string", "description": "The fact with its reason, max 1200 characters"},
          "from": {"enum": list(memory.MEMORY_FROM), "description": "consti = he said it; self = your note; external = web, mail, file"},
          "source": {"type": "string", "description": "Consti's words or where it came from"},
          "ifVersion": {"type": "integer", "description": "Version from memory_get when changing an entry"},
          "replaces": {"type": "array", "items": {"type": "string"}, "description": "Names of older entries this one replaces"}},
       "required": ["name", "type", "description", "body", "from", "source"]},
      label=_named("Merkt sich", "Merkt sich etwas …"), groups=False)
async def memory_save(run, a):
    return {"ok": True, **memory.save(run.ctx.db, run.bot["id"], a["name"], a["type"], a["description"], a["body"], a["from"], a["source"],
                                      a.get("ifVersion"), a.get("replaces"))}


@tool("memory_forget", "Delete one memory entry that is wrong or outdated, or when Consti asks to forget it.",
      {"type": "object", "properties": {"name": {"type": "string", "description": "Entry name from the memory index"}}, "required": ["name"]},
      label=_named("Räumt", "Räumt das Gedächtnis auf …"), groups=False)
async def memory_forget(run, args):
    memory.forget(run.ctx.db, run.bot["id"], args["name"].strip())
    return {"ok": True}


# ------------------------------------------------------------ Routine anlegen (dauerhaft: braucht Freigabe)
def _routine_risk(run, a) -> Risk:
    plan = schedule.describe(schedule.validate_schedule(a.get("schedule")), a.get("timezone") or TZ)
    schedule.validate_timezone(a.get("timezone") or TZ)
    name, where = str(a.get("name", "")).strip(), "neuer Chat je Lauf" if a.get("target") == "new" else "gleicher Chat"
    return Risk("dauerhaft", "automation_create", f"Routine „{name}“ anlegen: {plan}",
                f"Name: {name}\nPlan: {plan}, {where}\nAufgabe (wörtlich):\n{a.get('prompt', '')}")


@tool("automation_create", "Create a scheduled automation or routine. schedule is an object: "
      '{kind: daily|weekdays|weekly|monthly|once, at: "HH:MM", weekday?, day?, date?}. Default timezone Europe/Berlin.',
      {"type": "object", "properties": {
          "name": _text, "prompt": {"type": "string", "description": "Task description to execute when routine triggers"},
          "schedule": {"type": "object"}, "timezone": _text, "target": {"enum": ["same", "new"], "description": "same = this chat, new = separate chat"}},
       "required": ["name", "prompt", "schedule"]},
      label=_named("Legt Routine", "Legt eine Routine an …"), risk=_routine_risk, groups=False, available=lambda run: run.chat_kind == "direct")
async def automation_create(run, a):
    tz, target = a.get("timezone") or TZ, a.get("target") or "same"
    automation_id = automations.create(run.ctx.db, {"botId": run.bot["id"], "name": a["name"], "prompt": a["prompt"], "schedule": a["schedule"],
                                                    "timezone": tz, "target": target, "notify": "app"})
    out = {"ok": True, "id": automation_id, "message": f"„{a['name'].strip()}“ ist angelegt: {schedule.describe(a['schedule'], tz)}."}
    run.card("automation_create", new_id(), {k: a[k] for k in ("name", "prompt", "schedule", "target") if k in a}, out)
    return out


# ------------------------------------------------------------ Orbi anlegen (dauerhaft: braucht Freigabe)
def _orbi_risk(run, a) -> Risk:
    name, job = str(a.get("name", "")).strip(), str(a.get("job", "")).strip()
    detail = f"Name: {name}\nAufgabe: {job}" + (f"\nAnweisungen:\n{a['instructions']}" if a.get("instructions") else "")
    return Risk("dauerhaft", "create_orbi", f"Neuen Orbi „{name}“ anlegen: {job}", detail)


@tool("create_orbi", "Creates one new Orbi when Consti asked for it. This also creates its sandbox.",
      {"type": "object", "properties": {
          "name": {"type": "string", "description": "Name of the new Orbi, max 40 characters"}, "job": {"type": "string", "description": "Its task, max 60 characters"},
          "instructions": {"type": "string", "description": "Optional standing instructions, max 1000 characters"},
          "color": {"type": "string", "description": "Optional hex color like #3366ff"}}, "required": ["name", "job"]},
      label=_named("Legt Orbi", "Legt einen Orbi an …"), risk=_orbi_risk, groups=False, available=lambda run: run.chat_kind == "direct")
async def create_orbi(run, a):
    from ..routes import bots  # gleiche Logik wie POST /v1/bots; kein Hauptorbi
    taken = {r[0] for r in run.ctx.db.all("SELECT avatar FROM bots")}
    avatars = sorted(bots.AVATARS)
    body = {"name": a["name"], "job": a["job"], "avatar": next((v for v in avatars if v not in taken), avatars[0]), "isMain": False,
            **{k: a[k] for k in ("instructions", "color") if a.get(k)}}
    made = await bots.create_bot(Req({}, {}, body, run.ctx))
    name = a["name"].strip()
    out = {"ok": True, "name": name}
    run.card("create_orbi", new_id(), {"name": name, "job": a["job"].strip()}, out)
    run.ctx.bus.publish({"type": "orbis-created", "bots": [{"botId": made["id"], "chatId": made["chatId"], "name": name}]})
    return out


# ------------------------------------------------------------ Onboarding abschließen (nur solange onboarding_done=0)
INSTRUCTIONS_LIMIT = 1000  # Obergrenze der Orbi-Anweisung (wie im Formular)


def _onboarding_open(run) -> bool:
    """Nur Consti stellt die Regeln auf: nie in Läufen aus Orbi-Nachrichten, nach Fremddaten oder aus Routinen."""
    return (run.chat_kind == "direct" and not contract.foreign(run) and not getattr(run, "automation_id", None)
            and run.ctx.db.val("SELECT onboarding_done FROM bots WHERE id=?", run.bot["id"]) == 0)


ONBOARDING_ANSWERS = 3  # so viele eigene Antworten bleibt ein begonnenes Onboarding offen


def onboarding_running(db, bot_id: str, chat_id: str) -> bool:
    """Begonnenes Onboarding (Begrüßungszug lief): offen, solange eine Rückfrage offen ist oder der Orbi noch keine drei Antworten gab."""
    if not db.val("SELECT 1 FROM inbox_items WHERE bot_id=? AND chat_id=? AND dedupe_key LIKE 'onboarding:%'", bot_id, chat_id):
        return False
    return bool(db.val("SELECT 1 FROM pending_interactions WHERE bot_id=? AND chat_id=? AND kind='ask'", bot_id, chat_id)) \
        or db.val("SELECT count(*) FROM chat_messages WHERE chat_id=? AND role='assistant'", chat_id) < ONBOARDING_ANSWERS


def merge_instructions(current: str | None, job: str, addition: str) -> str | None:
    """Regeln an die vorhandene Anweisung anhängen, nie überschreiben; leer = keine Änderung. Zu lang: Anhang kürzen."""
    text = addition.strip()
    if not text:
        return current
    base = (current or "").strip() or job.strip()  # shortcut: ohne eigene Anweisung dient die Aufgabe als Grundlage (alt: Standardbeschreibung)
    room = INSTRUCTIONS_LIMIT - len(base) - 1
    if room < 40:
        return current
    return f"{base}\n{text if len(text) <= room else text[:room - 1].rstrip() + '…'}"


@tool("onboarding_finish", "Finish onboarding: save the user's answers as short working rules for you, or an empty string if the user skipped.",
      {"type": "object", "properties": {"instructions": {"type": "string", "maxLength": 600,
                                                          "description": "2-4 short rules in German, max 600 characters; empty if skipped"}},
       "required": ["instructions"]}, available=_onboarding_open, groups=False)
async def onboarding_finish(run, args):
    db, bot = run.ctx.db, run.bot
    current = db.val("SELECT instructions FROM bots WHERE id=?", bot["id"])
    merged = merge_instructions(current, bot["job"], str(args.get("instructions") or ""))
    changed = merged != current
    if db.run("UPDATE bots SET onboarding_done=1, instructions=? WHERE id=? AND onboarding_done=0", merged, bot["id"]) != 1:
        return "ok"
    run.ctx.bus.publish({"type": "onboarding", "botId": bot["id"], "done": True, "instructions": changed})
    return "ok"


# Nur im Fake-/Testbetrieb sichtbar: geld-Werkzeug für Freigabe-Abläufe ohne echte Ausgaben
@tool("test_spend", "Spend test money (tests only).", {"type": "object", "properties": {}},
      label=lambda a: "Gibt Testgeld aus …", risk=lambda run, a: Risk("geld", "test_spend", "Gibt Testgeld aus"),
      available=lambda run: bool(getattr(run.ctx.cfg, "fake_cli", None)))
async def test_spend(run, a):
    out = {"ok": True}
    run.card("test_spend", new_id(), {}, out)
    return out
