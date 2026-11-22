"""Werkzeug chat_recall: gekürzte Werkzeug-Ergebnisse stückweise zurückholen und den eigenen Verlauf durchsuchen."""
import re
import secrets

from ..runtime.contract import tool
from ..web import Fail

CHUNK, HITS = 4000, 5


def _frame(text: str) -> str:
    token = secrets.token_hex(6)
    return f"<untrusted_data_{token}>\n{text.replace('<', '&lt;')}\n</untrusted_data_{token}>"


@tool("chat_recall",
      "Looks up this chat only. id=<id> returns a shortened tool result in 4000-character pieces (offset to continue). query=<words> searches earlier messages (max 5 hits).",
      {"type": "object", "properties": {"query": {"type": "string"}, "id": {"type": "string"}, "offset": {"type": "integer", "minimum": 0}}},
      label=lambda a: f"Sucht im Verlauf: {a['query']}" if a.get("query") else "Holt Gekürztes aus dem Verlauf")
async def chat_recall(run, args: dict):
    db = run.ctx.db
    if args.get("id"):
        run.counters["untrusted"] = True  # volle Werkzeug-Ergebnisse können von außen stammen (Web, Mails): Stufe „extern“
        body = db.val("SELECT body FROM tool_outputs WHERE id=? AND chat_id=?", str(args["id"]), run.chat_id)
        if body is None:
            raise Fail("Dazu gibt es nichts (mehr) in diesem Chat.")
        start = max(int(args.get("offset") or 0), 0)
        end = min(start + CHUNK, len(body))
        more = f"\n[weiter mit offset={end}]" if end < len(body) else ""
        return _frame(body[start:end]) + f"\n[Zeichen {start}-{end} von {len(body)}]{more}"
    run.counters["eigen"] = True  # Suche im eigenen Verlauf: Stufe „eigen“ (nur dieser Lauf)
    words = re.findall(r"\w+", str(args.get("query") or ""))
    if not words:
        raise Fail("Gib eine Suche (query) oder eine id an.")
    for joiner in (" AND ", " OR "):
        rows = db.all("SELECT i.id, i.role, i.created_at, snippet(chat_messages_fts, 0, '«', '»', '…', 24) AS s FROM chat_messages_fts"
                      " JOIN chat_messages_index i ON i.rowid = chat_messages_fts.rowid WHERE chat_messages_fts MATCH ? AND i.chat_id = ? ORDER BY rank LIMIT ?",
                      joiner.join(f'"{w}"' for w in words), run.chat_id, HITS)
        if rows:
            return _frame("\n".join(f"- [{r['role']} id={r['id'].split(':', 1)[-1]}] {r['s']}" for r in rows))
    return "Keine Treffer in diesem Chat."
