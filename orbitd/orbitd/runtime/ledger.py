"""Wave 1 ledger: accepted requests, committed deliveries and bound side effects (schema 0016).

Rules every caller relies on:
- A request is persisted before dispatch. A stopped request refuses late deliveries and effects. "Stopped" is resolved
  from the stored rows (request ID or root run ID), never from what a caller chooses to pass.
- A delivery is committed before any event is emitted. The same client_key never creates a second row.
  Private deliveries are stored for the originator and are never emitted to a chat stream.
- An effect binds actor, principal, action class, target, account, recipients and payload digest. Status moves are
  compare-and-set on (status, version) and only happen through decide/claim/record/revise/cancel. Only the owner
  decides, only the bound actor claims, only the reviewed payload is dispatched, and an unknown outcome needs a receipt.
- Public entry points that can write and then raise must run at the top level (not inside db.tx()), so a persisted
  expiry or cancellation is never rolled back by the error that reports it.
"""
import hashlib
import json

from ..db import DB, dumps, loads, new_id, now_ms
from . import contract


class LedgerError(Exception):
    """A contract violation. The message is English and safe to show to the user."""


def _top(db: DB) -> None:
    if db.con.in_transaction:
        raise RuntimeError("ledger: call this at the top level, not inside db.tx()")


def _recipients(recipients) -> list[str]:
    return sorted({str(r) for r in (recipients or [])})


def digest(*, actor_bot_id: str, principal_id: str, action_class: str, target: str, account: str | None, recipients, payload) -> str:
    body = json.dumps({"actor": actor_bot_id, "principal": principal_id, "a": action_class, "t": target, "c": account,
                       "r": _recipients(recipients), "p": payload}, sort_keys=True, ensure_ascii=False, separators=(",", ":"), default=str)
    return hashlib.sha256(body.encode()).hexdigest()


# ---------------------------------------------------------------- requests
def accept_request(db: DB, chat_id: str, message_id: str, owner_bot_id: str, deliverables: list | None = None,
                   principal_id: str = "local", root_run_id: str | None = None) -> str:
    """Records an accepted user request once. Returns the existing ID on a replay."""
    t = now_ms()
    db.run("INSERT OR IGNORE INTO work_requests (id,chat_id,message_id,owner_bot_id,principal_id,root_run_id,deliverables,created_at,updated_at) "
           "VALUES (?,?,?,?,?,?,?,?,?)", new_id(), chat_id, message_id, owner_bot_id, principal_id, root_run_id, dumps(deliverables or []), t, t)
    request_id = db.val("SELECT id FROM work_requests WHERE chat_id=? AND message_id=? AND owner_bot_id=?", chat_id, message_id, owner_bot_id)
    if root_run_id:
        db.run("UPDATE work_requests SET root_run_id=? WHERE id=? AND root_run_id IS NULL", root_run_id, request_id)
    return request_id


def set_request(db: DB, request_id: str, status: str) -> bool:
    if status not in ("accepted", "working", "delivered", "cancelled", "failed"):
        raise LedgerError(f"Unknown request status: {status}")
    return db.run("UPDATE work_requests SET status=?, updated_at=? WHERE id=? AND status NOT IN ('cancelled','failed')",
                  status, now_ms(), request_id) == 1


def _stopped(db: DB, request_id: str | None, root_run_id: str | None) -> bool:
    if request_id and db.val("SELECT status FROM work_requests WHERE id=?", request_id) in contract.ROOT_STOPPED:
        return True
    if root_run_id and db.val("SELECT status FROM work_requests WHERE root_run_id=?", root_run_id) in contract.ROOT_STOPPED:
        return True
    return False


def stopped(db: DB, request_id: str | None = None, root_run_id: str | None = None) -> bool:
    return _stopped(db, request_id, root_run_id)


def _check_request(db: DB, request_id: str | None) -> None:
    if request_id and not db.val("SELECT 1 FROM work_requests WHERE id=?", request_id):
        raise LedgerError("Unknown work request.")


# ---------------------------------------------------------------- deliveries
_PRIVATE_KINDS = ("report",)
_PRIVATE_AUDIENCES = ("parent",)
_OWNER_ONLY_KINDS = ("secret-request",)   # shown only in the owner's own chat, never in a room, channel or meeting


def commit_delivery(db: DB, d: contract.Delivery) -> tuple[dict, bool]:
    """Stores the delivery atomically. Returns (row, created). A replay returns the first row unchanged."""
    if d.kind not in contract.DELIVERY_KINDS:
        raise LedgerError(f"Unknown delivery kind: {d.kind}")
    if d.audience not in contract.AUDIENCES:
        raise LedgerError(f"Unknown audience: {d.audience}")
    if d.visibility not in ("public", "private"):
        raise LedgerError(f"Unknown visibility: {d.visibility}")
    if (d.kind in _PRIVATE_KINDS or d.audience in _PRIVATE_AUDIENCES) and d.visibility != "private":
        raise LedgerError("A worker report goes only to its originator.")
    if d.kind in _OWNER_ONLY_KINDS and d.audience not in ("chat", "dm"):
        raise LedgerError("Secure input can only be requested in the owner's own chat.")
    with db.tx():
        existing = db.one("SELECT * FROM deliveries WHERE client_key=?", d.client_key)
        if existing:
            return _row(existing), False
        _check_request(db, d.request_id)
        if _stopped(db, d.request_id, d.root_run_id):
            raise LedgerError("This work was stopped. The late result was not delivered.")
        delivery_id, t = new_id(), now_ms()
        db.run("INSERT INTO deliveries (id,client_key,run_id,root_run_id,request_id,chat_id,thread_root_id,audience,channel,recipient,"
               "kind,visibility,message_id,parts,artifacts,end_turn,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
               delivery_id, d.client_key, d.run_id, d.root_run_id, d.request_id, d.chat_id, d.thread_root_id, d.audience,
               d.channel, d.recipient, d.kind, d.visibility, d.message_id, dumps(d.parts), dumps(d.artifacts),
               1 if d.end_turn else 0, "committed", t)
        return _row(db.one("SELECT * FROM deliveries WHERE id=?", delivery_id)), True


_LIVE = ("NOT EXISTS (SELECT 1 FROM work_requests w WHERE w.status IN ('cancelled','failed') AND "
         "(w.id = deliveries.request_id OR (deliveries.root_run_id IS NOT NULL AND w.root_run_id = deliveries.root_run_id)))")


def pending_emits(db: DB, chat_id: str | None = None) -> list[dict]:
    """Public deliveries committed but not yet emitted and not stopped, oldest first (replayed after a restart)."""
    sql = f"SELECT * FROM deliveries WHERE status='committed' AND visibility='public' AND {_LIVE}"
    rows = db.all(sql + (" AND chat_id=?" if chat_id else "") + " ORDER BY created_at, rowid", *([chat_id] if chat_id else []))
    return [_row(r) for r in rows]


def mark_emitted(db: DB, delivery_id: str) -> bool:
    """True only for the first caller; a second emitter must not publish again."""
    return db.run(f"UPDATE deliveries SET status='emitted', emitted_at=? WHERE id=? AND status='committed' AND visibility='public' AND {_LIVE}",
                  now_ms(), delivery_id) == 1


def private_results(db: DB, root_run_id: str) -> list[dict]:
    return [_row(r) for r in db.all("SELECT * FROM deliveries WHERE root_run_id=? AND visibility='private' ORDER BY created_at, rowid", root_run_id)]


def _row(row) -> dict:
    out = dict(row)
    out["parts"], out["artifacts"], out["end_turn"] = loads(out["parts"], []), loads(out["artifacts"], []), bool(out["end_turn"])
    return out


# ---------------------------------------------------------------- effects
def _insert_effect(db: DB, *, chat_id, actor_bot_id, action_class, target, payload, account, recipients, ttl_ms, run_id,
                   root_run_id, call_id, request_id, principal_id, status) -> str:
    recipients = _recipients(recipients)
    d = digest(actor_bot_id=actor_bot_id, principal_id=principal_id, action_class=action_class, target=target,
               account=account, recipients=recipients, payload=payload)
    effect_id, t = new_id(), now_ms()
    db.run("INSERT INTO effects (id,call_id,run_id,root_run_id,request_id,chat_id,actor_bot_id,principal_id,action_class,target,account,recipients,"
           "payload,payload_digest,status,expires_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
           effect_id, call_id, run_id, root_run_id, request_id, chat_id, actor_bot_id, principal_id, action_class, target, account,
           dumps(recipients), dumps(payload), d, status, t + ttl_ms, t, t)
    return effect_id


def open_effect(db: DB, *, chat_id: str, actor_bot_id: str, action_class: str, target: str, payload, account: str | None = None,
                recipients: list | None = None, ttl_ms: int = contract.INTERACTION_TTL_MS, run_id: str | None = None,
                root_run_id: str | None = None, call_id: str | None = None, request_id: str | None = None,
                principal_id: str = "local", status: str = "pending") -> str:
    if status not in ("draft", "pending"):
        raise LedgerError("A new effect starts as a draft or a pending review.")
    if not db.val("SELECT 1 FROM principals WHERE id=?", principal_id):
        raise LedgerError("Unknown principal.")
    with db.tx():
        _check_request(db, request_id)
        if _stopped(db, request_id, root_run_id):
            raise LedgerError("This work was stopped. No new action was prepared.")
        return _insert_effect(db, chat_id=chat_id, actor_bot_id=actor_bot_id, action_class=action_class, target=target,
                              payload=payload, account=account, recipients=recipients, ttl_ms=ttl_ms, run_id=run_id,
                              root_run_id=root_run_id, call_id=call_id, request_id=request_id, principal_id=principal_id, status=status)


def effect(db: DB, effect_id: str) -> dict | None:
    row = db.one("SELECT * FROM effects WHERE id=?", effect_id)
    if not row:
        return None
    out = dict(row)
    out["payload"], out["recipients"], out["receipt"] = loads(out["payload"]), loads(out["recipients"], []), loads(out["receipt"])
    return out


def _cas(db: DB, row, to: str, *, decided_by=None, operation_id=None, receipt=None) -> int:
    """Inside a transaction: one legal compare-and-set move. Returns the new version."""
    if to not in contract.EFFECT_TRANSITIONS.get(row["status"], ()):
        raise LedgerError(f"This action is already {row['status']}.")
    t = now_ms()
    changed = db.run("UPDATE effects SET status=?, version=version+1, updated_at=?, decided_by=COALESCE(?,decided_by), "
                     "decided_at=CASE WHEN ? IN ('approved','denied') THEN ? ELSE decided_at END, "
                     "operation_id=COALESCE(?,operation_id), receipt=COALESCE(?,receipt) WHERE id=? AND status=? AND version=?",
                     to, t, decided_by, to, t, operation_id, dumps(receipt) if receipt is not None else None,
                     row["id"], row["status"], row["version"])
    if changed != 1:
        raise LedgerError("This action changed after it was shown. Review it again.")
    return row["version"] + 1


def _transition(db: DB, effect_id: str, version: int, to: str, check=None, **kw) -> int:
    """Top-level guarded move. Expiry and stop are persisted first and reported afterwards."""
    _top(db)
    failure = None
    with db.tx():
        row = db.one("SELECT * FROM effects WHERE id=?", effect_id)
        if not row:
            raise LedgerError("This action no longer exists.")
        if row["version"] != version:
            raise LedgerError("This action changed after it was shown. Review it again.")
        live = row["status"] in ("draft", "pending", "interrupted", "approved")
        if live and to not in ("cancelled", "expired") and _stopped(db, row["request_id"], row["root_run_id"]):
            _cas(db, row, "cancelled")
            failure = "This work was stopped. Nothing was sent."
        elif live and to in ("approved", "denied", "claimed", "pending") and row["expires_at"] <= now_ms():
            _cas(db, row, "expired")
            failure = "This review expired. Nothing was sent."
        else:
            if check:
                check(row)
            new_version = _cas(db, row, to, **kw)
    if failure:
        raise LedgerError(failure)
    return new_version


def decide(db: DB, effect_id: str, approve: bool, version: int, principal_id: str) -> int:
    """Owner decision on a pending review. principal_id must come from the authenticated session, never a request body."""
    def owner(row):
        if principal_id != row["principal_id"] or db.val("SELECT kind FROM principals WHERE id=?", principal_id) != "owner":
            raise LedgerError("Only the owner of this action can decide it.")
    return _transition(db, effect_id, version, "approved" if approve else "denied", owner, decided_by=principal_id)


def claim(db: DB, effect_id: str, version: int, *, actor_bot_id: str, payload, recipients=None) -> int:
    """Claims an approved effect for exactly one dispatch by its bound actor with exactly the reviewed payload."""
    def bound(row):
        if actor_bot_id != row["actor_bot_id"]:
            raise LedgerError("This action belongs to another Orbi.")
        d = digest(actor_bot_id=actor_bot_id, principal_id=row["principal_id"], action_class=row["action_class"], target=row["target"],
                   account=row["account"], recipients=loads(row["recipients"], []) if recipients is None else recipients, payload=payload)
        if d != row["payload_digest"]:
            raise LedgerError("The content changed after review. Review it again before sending.")
    return _transition(db, effect_id, version, "claimed", bound)


def record(db: DB, effect_id: str, version: int, outcome: str, *, operation_id: str | None = None, receipt=None) -> int:
    """Dispatch outcome: dispatched, unknown, done or failed. Leaving 'unknown' requires a provider receipt or readback."""
    if outcome not in ("dispatched", "unknown", "done", "failed"):
        raise LedgerError(f"Unknown outcome: {outcome}")
    def readback(row):
        if row["status"] == "unknown" and receipt is None:
            raise LedgerError("An unknown outcome is settled only by the provider's receipt or readback.")
    return _transition(db, effect_id, version, outcome, readback, operation_id=operation_id, receipt=receipt)


def restore(db: DB, effect_id: str, version: int) -> int:
    """Shows an interrupted review again (same payload, new version)."""
    return _transition(db, effect_id, version, "pending")


def revise(db: DB, effect_id: str, version: int, payload, recipients: list | None = None) -> str:
    """A changed draft supersedes the reviewed one and opens a fresh review, atomically."""
    _top(db)
    with db.tx():
        old = db.one("SELECT * FROM effects WHERE id=?", effect_id)
        if not old or old["version"] != version:
            raise LedgerError("This action changed after it was shown. Review it again.")
        if _stopped(db, old["request_id"], old["root_run_id"]):
            raise LedgerError("This work was stopped. No new action was prepared.")
        new = _insert_effect(db, chat_id=old["chat_id"], actor_bot_id=old["actor_bot_id"], action_class=old["action_class"],
                             target=old["target"], payload=payload, account=old["account"],
                             recipients=loads(old["recipients"], []) if recipients is None else recipients,
                             ttl_ms=contract.INTERACTION_TTL_MS, run_id=old["run_id"], root_run_id=old["root_run_id"],
                             call_id=old["call_id"], request_id=old["request_id"], principal_id=old["principal_id"], status="pending")
        _cas(db, old, "superseded")
        return new


def interrupt_open(db: DB) -> int:
    """Restart: expired reviews expire, open and approved-but-unsent reviews become interrupted (asked again),
    and anything claimed or dispatched becomes unknown until a receipt or readback settles it."""
    t, n = now_ms(), 0
    with db.tx():
        n += db.run("UPDATE effects SET status='expired', version=version+1, updated_at=? WHERE status IN ('pending','approved','interrupted') AND expires_at<=?", t, t)
        n += db.run("UPDATE effects SET status='interrupted', version=version+1, updated_at=? WHERE status IN ('pending','approved')", t)
        n += db.run("UPDATE effects SET status='unknown', version=version+1, updated_at=? WHERE status IN ('claimed','dispatched')", t)
    return n


def cancel_root(db: DB, request_id: str) -> int:
    """Stops a request atomically: its open effects are cancelled and undelivered public results are refused.
    Dispatched effects are left for reconciliation."""
    with db.tx():
        db.run("UPDATE work_requests SET status='cancelled', updated_at=? WHERE id=? AND status NOT IN ('cancelled','failed')", now_ms(), request_id)
        root = db.val("SELECT root_run_id FROM work_requests WHERE id=?", request_id)
        t = now_ms()
        n = db.run("UPDATE effects SET status='cancelled', version=version+1, updated_at=? WHERE status IN ('draft','pending','interrupted','approved') "
                   "AND (request_id=? OR (? IS NOT NULL AND root_run_id=?))", t, request_id, root, root)
        db.run("UPDATE deliveries SET status='refused' WHERE status='committed' AND (request_id=? OR (? IS NOT NULL AND root_run_id=?))",
               request_id, root, root)
    return n
