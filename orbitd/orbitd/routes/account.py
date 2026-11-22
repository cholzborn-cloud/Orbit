"""Clerk Native Frontend API for the optional Orbit profile account."""
import asyncio
import base64
import binascii
import os
import re
from urllib.parse import parse_qs, urlsplit

import httpx

from .. import keychain
from ..config import isolated_dir
from ..db import dumps, loads, now_ms
from ..web import Fail, Req, route

SERVICE_ACCOUNT = "RUST_CLERK_CLIENT"
CALLBACK = "orbit-rust://auth/callback"
IDENTIFIER = re.compile(r"[a-zA-Z0-9_-]{1,160}\Z")
EMAIL = re.compile(r"[^\s@]{1,120}@[^\s@]{1,120}\.[^\s@]{1,80}\Z")


def configuration() -> str | None:
    """The publishable key authenticates the configured FAPI host, not the user."""
    key = os.environ.get("ORBIT_CLERK_PUBLISHABLE_KEY", "")
    url = os.environ.get("ORBIT_CLERK_FRONTEND_URL", "")
    match = re.fullmatch(r"pk_(?:live|test)_([\w-]{1,512})", key, re.ASCII)
    if not match:
        return None
    try:
        value = match[1]
        host = base64.urlsafe_b64decode(value + "=" * (-len(value) % 4)).decode("ascii").removesuffix("$")
        base = urlsplit(url)
        if base.scheme == "https" and base.netloc.lower() == host.lower() and base.path in ("", "/") and not base.query and not base.fragment and "." in host and base.hostname == host.lower() and not base.username and not base.port:
            return f"https://{host}"
    except (ValueError, UnicodeError, binascii.Error):
        pass
    return None


def _identity(value) -> str:
    if isinstance(value, str) and IDENTIFIER.fullmatch(value):
        return value
    raise Fail("Der Kontodienst hat einen unerwarteten Vorgang zurückgegeben.")


def _public_record(db) -> dict:
    value = loads(db.val("SELECT value FROM app_kv WHERE key='orbit_account'"), {})
    return value if isinstance(value, dict) else {}


def _save(db, record: dict) -> None:
    db.run("INSERT OR REPLACE INTO app_kv (key,value,updated_at) VALUES ('orbit_account',?,?)", dumps(record), now_ms())


class Clerk:
    """One pending native flow per profile. Passwords and verification codes stay in requests."""
    def __init__(self, origin: str, transport: httpx.AsyncBaseTransport | None = None):
        self.origin, self.transport = origin, transport
        self.token: str | None = None
        self.lock = asyncio.Lock()
        self.pending: dict | None = None

    async def request(self, method: str, path: str, body=None, query=None) -> dict:
        headers = {"Accept": "application/json", "Clerk-API-Version": "2025-11-10", "X-Bundle-Id": "de.consti.orbit.rust"}
        if self.token:
            headers["Authorization"] = self.token
        try:
            async with httpx.AsyncClient(transport=self.transport, timeout=12, follow_redirects=False, trust_env=False) as http:
                response = await http.request(method, f"{self.origin}/v1/client{path}", data=body,
                                              params={"_is_native": "true", **(query or {})}, headers=headers)
            content = response.json()
        except (httpx.HTTPError, ValueError):
            raise Fail("Der Orbit-Kontodienst ist gerade nicht erreichbar.") from None
        if response.status_code >= 400:
            code = next((e.get("code") for e in content.get("errors", []) if isinstance(e, dict)), None) if isinstance(content, dict) else None
            raise Fail({
                "form_code_incorrect": "Der Code stimmt nicht. Prüfe ihn und versuche es erneut.",
                "verification_expired": "Der Code ist abgelaufen. Fordere einen neuen an.",
                "form_password_incorrect": "E-Mail-Adresse oder Passwort stimmt nicht.",
                "form_identifier_not_found": "E-Mail-Adresse oder Passwort stimmt nicht.",
                "form_identifier_exists": "Zu dieser E-Mail-Adresse gibt es bereits ein Konto.",
                "form_password_pwned": "Wähle ein anderes Passwort.",
                "form_password_length_too_short": "Das Passwort ist zu kurz.",
            }.get(code, "Der Kontodienst hat den Vorgang abgelehnt. Versuche es erneut."))
        token = response.headers.get("authorization")
        if token is not None:
            self.token = token if 4 <= len(token) <= 8192 else None
        if not isinstance(content, dict):
            raise Fail("Der Kontodienst hat unerwartet geantwortet.")
        return content

    async def finish(self, db, result: dict) -> dict:
        remote = result.get("response")
        if not isinstance(remote, dict) or remote.get("status") != "complete":
            raise Fail("Der Kontodienst verlangt einen weiteren Bestätigungsschritt.")
        session = _identity(remote.get("created_session_id"))
        client = result.get("client") or {}
        sessions = client.get("sessions") or [] if isinstance(client, dict) else []
        verified = next((entry for entry in sessions if isinstance(entry, dict) and entry.get("id") == session), {})
        user = verified.get("user") or {}
        if not isinstance(user, dict):
            user = {}
        account = _identity(user.get("id") or remote.get("created_user_id"))
        pending = self.pending or {}
        emails = user.get("email_addresses") or []
        primary = user.get("primary_email_address_id")
        email = next((e.get("email_address") for e in emails if isinstance(e, dict) and e.get("id") == primary), pending.get("email", ""))
        if not isinstance(email, str) or not EMAIL.fullmatch(email):
            email = ""
        if not self.token:
            raise Fail("Der Kontodienst hat diese Anmeldung nicht bestätigt.")
        try:
            await keychain.set_item(keychain.SERVICE, SERVICE_ACCOUNT, self.token)
        except (ValueError, OSError):
            raise Fail("Die Orbit-Anmeldung ließ sich nicht im Schlüsselbund sichern.") from None
        record = {"mode": "clerk", "id": account, "session": session, "email": email}
        _save(db, record)
        self.pending = None
        return {"ok": True, "phase": "done", "email": email}

    async def prepare_code(self) -> dict:
        pending = self.pending
        if not pending or pending["type"] not in ("signup", "signin"):
            raise Fail("Starte die Bestätigung zuerst.")
        if pending["type"] == "signup":
            path = f"/sign_ups/{pending['id']}/prepare_verification"
            body = {"strategy": "email_code"}
        else:
            path = f"/sign_ins/{pending['id']}/prepare_second_factor"
            body = {"strategy": "email_code", "email_address_id": pending["addressId"]}
        await self.request("POST", path, body)
        return {"ok": True, "phase": "code", "email": pending["email"]}


def _clerk(req: Req) -> Clerk:
    provider = req.ctx.parts.get("account_clerk")
    if provider is not None:
        return provider
    origin = configuration()
    if not isolated_dir() or not origin:
        raise Fail("Der Orbit-Kontodienst ist auf diesem Mac nicht eingerichtet.")
    provider = req.ctx.parts["account_clerk"] = Clerk(origin)
    return provider


@route("GET", "/v1/setup/account")
async def account_status(req: Req):
    record = _public_record(req.ctx.db)
    provider = req.ctx.parts.get("account_clerk")
    pending = provider.pending if provider else None
    return {"ok": True, "configured": bool(provider or isolated_dir() and configuration() or record.get("mode") == "supabase"),
            "mode": record.get("mode"),
            "email": record.get("email", pending.get("email") if pending else None),
            "phase": "done" if record else ("browser" if pending["type"] == "oauth" else "code") if pending else "start"}


@route("POST", "/v1/setup/account/{action}")
async def account_action(req: Req):
    action, body, db = req.params["action"], req.obj(), req.ctx.db
    if action == "local":
        if req.ctx.parts.get("account_clerk") or configuration():
            raise Fail("Dieses Orbit-Profil wird über den Kontodienst eingerichtet.")
        _save(db, {"mode": "local"})
        return {"ok": True, "phase": "done"}
    if action == "supabase":
        # Firebase ist raus: die Hülle meldet die Supabase-UID nach dem Login.
        raw_id, raw_email, raw_name = body.get("id"), body.get("email"), body.get("displayName")
        account_id = raw_id.strip() if isinstance(raw_id, str) else ""
        if not account_id or not IDENTIFIER.fullmatch(account_id):
            raise Fail("Die Supabase-Anmeldung hat keine gültige Kennung geliefert.")
        email = raw_email.strip() if isinstance(raw_email, str) and EMAIL.fullmatch(raw_email.strip()) else ""
        name = raw_name.strip()[:120] if isinstance(raw_name, str) else ""
        _save(db, {"mode": "supabase", "id": account_id, "email": email, "displayName": name})
        return {"ok": True, "phase": "done", "email": email}
    if action == "logout" and _public_record(db).get("mode") != "clerk":
        # Supabase/local: nur den Eintrag löschen. Clerk folgt weiter unten.
        db.run("DELETE FROM app_kv WHERE key='orbit_account'")
        return {"ok": True, "phase": "start"}
    provider = _clerk(req)
    async with provider.lock:
        if action == "cancel":
            provider.pending = None
            provider.token = None
            return {"ok": True, "phase": "start"}
        if action == "logout":
            record = _public_record(db)
            session = record.get("session")
            provider.token = await keychain.get(SERVICE_ACCOUNT)
            if session and provider.token:
                await provider.request("POST", f"/sessions/{_identity(session)}/end", {})
            await keychain.delete_item(keychain.SERVICE, SERVICE_ACCOUNT)
            provider.token = provider.pending = None
            db.run("DELETE FROM app_kv WHERE key='orbit_account'")
            return {"ok": True, "phase": "start"}
        if action in ("signup", "signin"):
            raw_email, password = body.get("email"), body.get("password")
            email = raw_email.strip() if isinstance(raw_email, str) else ""
            if not EMAIL.fullmatch(email) or not isinstance(password, str) or not 1 <= len(password) <= 1024:
                raise Fail("Gib E-Mail-Adresse und Passwort ein.")
            provider.pending = None
            if action == "signup":
                result = await provider.request("POST", "/sign_ups", {"email_address": email, "password": password})
            else:
                result = await provider.request("POST", "/sign_ins", {"identifier": email, "strategy": "password", "password": password})
            remote = result.get("response") or {}
            if not isinstance(remote, dict):
                raise Fail("Der Kontodienst hat unerwartet geantwortet.")
            provider.pending = {"type": action, "id": _identity(remote.get("id")), "email": email}
            if remote.get("status") == "complete":
                return await provider.finish(db, result)
            if action == "signin":
                factor = next((factor for factor in remote.get("supported_second_factors") or []
                               if isinstance(factor, dict) and factor.get("strategy") == "email_code"), None)
                if not factor:
                    provider.pending = None
                    raise Fail("Für dieses Konto verlangt der Kontodienst eine andere Sicherheitsprüfung.")
                provider.pending["addressId"] = _identity(factor.get("email_address_id"))
            return await provider.prepare_code()
        if action == "resend":
            return await provider.prepare_code()
        if action == "verify":
            pending = provider.pending
            code = body.get("code")
            if not pending or pending["type"] not in ("signup", "signin") or not isinstance(code, str) or not re.fullmatch(r"[0-9]{4,10}", code):
                raise Fail("Gib den aktuellen E-Mail-Code ein.")
            suffix = f"/sign_ups/{pending['id']}/attempt_verification" if pending["type"] == "signup" else f"/sign_ins/{pending['id']}/attempt_second_factor"
            return await provider.finish(db, await provider.request("POST", suffix, {"strategy": "email_code", "code": code}))
        if action == "google":
            provider.pending = None
            data = await provider.request("POST", "/sign_ins", {"strategy": "oauth_google", "redirect_url": CALLBACK})
            remote = data.get("response") or {}
            url = (remote.get("first_factor_verification") or {}).get("external_verification_redirect_url")
            target = urlsplit(url) if isinstance(url, str) else urlsplit("")
            if target.scheme != "https" or not target.hostname or target.username or target.password:
                raise Fail("Der Kontodienst hat keine sichere Google-Anmeldeadresse geliefert.")
            provider.pending = {"type": "oauth", "id": _identity(remote.get("id"))}
            return {"ok": True, "phase": "browser", "url": url}
        if action == "callback":
            pending = provider.pending
            url = body.get("url")
            if not pending or pending["type"] != "oauth" or not isinstance(url, str) or len(url) > 8192:
                raise Fail("Diese Google-Anmeldung ist abgelaufen.")
            callback = urlsplit(url)
            if url.split("?", 1)[0] != CALLBACK:
                raise Fail("Die Rückkehr von Google ist ungültig.")
            query = parse_qs(callback.query)
            nonce = (query.get("rotating_token_nonce") or [""])[0]
            if not re.fullmatch(r"[A-Za-z0-9_.-]{1,4096}", nonce):
                raise Fail("Google hat die Anmeldung nicht bestätigt. Versuche es erneut.")
            result = await provider.request("GET", f"/sign_ins/{pending['id']}", query={"rotating_token_nonce": nonce})
            remote = result.get("response") or {}
            if (remote.get("first_factor_verification") or {}).get("status") == "transferable":
                result = await provider.request("POST", "/sign_ups", {"transfer": "true"})
            return await provider.finish(db, result)
    raise Fail("Unbekannte Kontoaktion.")
