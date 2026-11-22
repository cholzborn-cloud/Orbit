"""Agent Client Protocol (JSON-RPC über stdio) für Cursor und Antigravity. Nur diese beiden nutzen ACP.

Ablauf je Zug: initialize -> session/new oder session/load (mit Orbits MCP-Server) -> Modell setzen -> session/prompt.
Rechte-Anfragen des Agenten: Orbits eigene MCP-Werkzeuge sind erlaubt (die Freigabe passiert dort), alles andere wird abgelehnt.
"""
import asyncio
import json
import re
from contextlib import aclosing
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import AsyncIterator

from ..redact import redact
from .base import Adapter, CliError, Ev, ProcessTree, Turn, base_env
from .catalog import CURSOR_ID, cursor_entry


ASK_REMINDER = ("\n\n[Orbit-Erinnerung: Fragen an Consti nie im Text, immer als Karte mit dem Werkzeug ask_user. "
                "Vorher kurz prüfen, ob du es nicht selbst lösen kannst. Antworte kurz, ohne Häkchen-Schema und ohne vollen Namen.]")


class AcpAdapter(Adapter):
    acp_args: list[str] = ["acp"]

    def explain(self, raw: str) -> str:
        raw = redact(raw)
        low = raw.lower()
        if "auth" in low or "log in" in low or "login" in low:
            return f"{self.label} ist nicht angemeldet. Melde dich im Terminal mit „{self.binary}“ an."
        if "limit" in low or "quota" in low:
            return f"{self.label} hat sein Nutzungslimit erreicht."
        return f"{self.label} konnte nicht antworten. ({raw.strip()[:200]})" if raw.strip() else f"{self.label} hat ohne Ergebnis aufgehört."

    async def run(self, turn: Turn, tree_ready, *, catalog: bool = False) -> AsyncIterator[Ev]:
        tree = await ProcessTree.spawn([*self.argv0(), *self.acp_args], turn.cwd, base_env(turn), self.keychain)
        tree_ready(tree)
        next_id = 0
        queue: asyncio.Queue = asyncio.Queue()

        async def pump():
            async for line in tree.lines():
                try:
                    await queue.put(json.loads(line))
                except ValueError:
                    pass
            await queue.put(None)

        reader = asyncio.create_task(pump())

        async def write(message: dict):
            await tree.send(json.dumps({"jsonrpc": "2.0", **message}) + "\n")

        async def call(method: str, params: dict) -> int:
            nonlocal next_id
            next_id += 1
            await write({"id": next_id, "method": method, "params": params})
            return next_id

        async def answer(request_id: int) -> AsyncIterator[dict]:
            """Liefert Zwischennachrichten als {'note': …} und am Ende {'result': …}."""
            while True:
                message = await queue.get()
                if message is None:
                    raise CliError(self.explain(await tree.stderr_tail()))
                if message.get("id") == request_id and "method" not in message:
                    if "error" in message:
                        raise CliError(self.explain(json.dumps(message["error"], ensure_ascii=False)))
                    yield {"result": message.get("result") or {}}
                    return
                if "method" in message:
                    yield {"note": message}

        async def result_of(request_id: int) -> dict:
            async for item in answer(request_id):
                if "result" in item:
                    return item["result"]
            return {}

        try:
            init = await result_of(await call("initialize", {
                "protocolVersion": 1, "clientInfo": {"name": "orbitd", "version": "2"},
                "clientCapabilities": {"fs": {"readTextFile": False, "writeTextFile": False}, "terminal": False}}))
            mcp = [{"type": "http", "name": "orbit", "url": turn.mcp_url,
                    "headers": [{"name": "Authorization", "value": f"Bearer {turn.run_token}"}]}] if turn.mcp_url else []
            can_load = (init.get("agentCapabilities") or {}).get("loadSession")
            session, created = None, None
            if turn.session and can_load:
                try:
                    created = await result_of(await call("session/load", {"sessionId": turn.session, "cwd": str(turn.cwd), "mcpServers": mcp}))
                    session = turn.session
                except CliError:
                    session = None  # Sitzung gibt es nicht mehr: neue beginnen
            fresh = session is None
            if fresh:
                created = await result_of(await call("session/new", {"cwd": str(turn.cwd), "mcpServers": mcp}))
                session = created.get("sessionId")
            offered = ((created or {}).get("models") or {}).get("availableModels") or []
            if catalog:
                yield Ev("models", {"entries": offered})
                return
            known = [m.get("modelId") for m in offered]
            # Cursor (live 13.11.) nennt Modelle mit Zusatz: „composer-2.5[fast=true]“, Auto heißt „default[]“
            want = "default" if turn.model == "auto" else turn.model
            model = turn.model if turn.model in known or not known else None
            if model is None and "[" not in want:
                model = next((k for k in known if str(k).split("[")[0] == want), None)
            if model is None:
                # Fest gewähltes Modell wechselt nie still: lieber Fehler als ein anderes Modell.
                raise CliError(f"{self.label} kennt das Modell „{turn.model}“ nicht. Bekannt: {', '.join(map(str, known[:8]))}")
            yield Ev("session", {"id": session, "model": turn.model})
            await result_of(await call("session/set_model", {"sessionId": session, "modelId": model}))
            # Anleitung bei JEDEM Zug mitschicken (wie bei Claude und Codex): Eine fortgesetzte Sitzung kennt sonst nur die alte Fassung,
            # neue Antwort-Einstellungen und Regeln kämen nie an und das Modell driftet über lange Chats in alte Gewohnheiten (20.11.2026).
            text = f"{turn.system}\n\n---\n\n{turn.prompt}" if turn.system else turn.prompt
            if turn.system:
                text += ASK_REMINDER
            prompt_id = await call("session/prompt", {"sessionId": session, "prompt": [{"type": "text", "text": text}]})
            async for item in answer(prompt_id):
                if "result" in item:
                    usage = item["result"].get("usage") or {}
                    yield Ev("usage", {"inputTokens": usage.get("inputTokens", 0), "outputTokens": usage.get("outputTokens", 0),
                                       "cachedTokens": usage.get("cachedReadTokens", 0), "costUsd": None})
                    reason = item["result"].get("stopReason", "end_turn")
                    if reason in ("end_turn", "max_tokens", "max_turn_requests"):
                        yield Ev("done", {"reason": reason})
                    else:
                        yield Ev("error", {"text": self.explain(reason)})
                    break
                note = item["note"]
                if note.get("method") == "session/update":
                    for ev in self.translate((note.get("params") or {}).get("update") or {}):
                        yield ev
                elif note.get("method") == "session/request_permission":
                    await write({"id": note["id"], "result": {"outcome": self.permit(note.get("params") or {})}})
                elif "id" in note:
                    await write({"id": note["id"], "error": {"code": -32601, "message": "nicht unterstützt"}})
        finally:
            reader.cancel()
            await tree.kill()

    @staticmethod
    def permit(params: dict) -> dict:
        """Nur ein Aufruf nachweislich eines Orbit-Werkzeugs bekommt allow_once; alles andere, auch Unklares, reject_once."""
        wanted = "allow_once" if AcpAdapter.is_orbit_tool(params.get("toolCall") or {}) else "reject_once"
        for option in params.get("options") or []:
            if option.get("kind") == wanted:
                return {"outcome": "selected", "optionId": option.get("optionId")}
        return {"outcome": "cancelled"}

    @staticmethod
    def is_orbit_tool(call: dict) -> bool:
        """Das ACP-Schema hat kein Feld für den MCP-Server; belegt ist nur der Titel (so liefert ihn unsere Attrappe: „orbit: <werkzeug>“).
        Darum: Titel ganz und genau „orbit: name“ / „orbit.name“ / „mcp__orbit__name“ mit bekanntem Orbit-Werkzeug, Art kein execute/edit/delete/move/fetch,
        und ein gesetztes `_meta`-Feld für den Server (Name `server`/`serverName`/`mcpServer`) muss „orbit“ sein."""
        from ..runtime.contract import TOOLS
        # Antigravity (live 13.11.): Titel „Run mcp_orbit_<werkzeug>“; Cursor (live 13.11.): „orbit-<werkzeug>: <werkzeug>“
        m = re.fullmatch(r"(?:orbit[:.] ?|mcp__orbit__|Run mcp_orbit_|orbit-(?=([A-Za-z0-9_]+): \1$)[A-Za-z0-9_]+: )([A-Za-z0-9_\-]+)", str(call.get("title") or "").strip())
        if not m or m.group(2) not in TOOLS or call.get("kind") in ("execute", "edit", "delete", "move", "fetch"):
            return False
        meta = call.get("_meta") if isinstance(call.get("_meta"), dict) else {}
        return all(meta[k] == "orbit" for k in ("server", "serverName", "mcpServer") if k in meta)

    @staticmethod
    def translate(update: dict) -> list[Ev]:
        kind = update.get("sessionUpdate")
        content = update.get("content") or {}
        if kind == "agent_message_chunk" and content.get("type") == "text":
            return [Ev("text", {"delta": content.get("text", "")})]
        if kind == "agent_thought_chunk" and content.get("type") == "text":
            return [Ev("think", {"delta": content.get("text", "")})]
        if kind == "tool_call":
            return [Ev("tool_start", {"id": update.get("toolCallId"), "name": update.get("title") or update.get("kind") or "werkzeug", "input": update.get("rawInput") or {}})]
        if kind == "tool_call_update" and update.get("status") in ("completed", "failed"):
            return [Ev("tool_end", {"id": update.get("toolCallId"), "name": update.get("title") or "", "ok": update.get("status") == "completed", "output": update.get("rawOutput")})]
        return []


class Cursor(AcpAdapter):
    name, binary, label = "cursor", "cursor-agent", "Cursor"
    keychain = True  # Bestehende Profile können den Schlüsselbund nutzen; getrennte Profile speichern als Datei.

    async def catalog(self) -> list[dict]:
        # Die Modell-IDs kommen aus demselben Protokoll, das sie beim Chat auswählt.
        with TemporaryDirectory(prefix="orbit-cursor-catalog-") as cwd:
            turn = Turn("", "", "", None, Path(cwd), None, "", "")
            async with asyncio.timeout(8), aclosing(self.run(turn, lambda _: None, catalog=True)) as events:
                entries = (await anext(events)).data["entries"]
        models = {}
        for entry in entries:
            model_id = entry.get("modelId")
            if isinstance(model_id, str) and CURSOR_ID.fullmatch(model_id):
                model = cursor_entry(model_id, entry.get("name"))
                models.setdefault(model["id"], model)
        return list(models.values())


class Agy(AcpAdapter):
    name, binary, label = "agy", "agy", "Antigravity"
    keychain = True  # live belegt (13.11.): ohne `security` meldet agy „nicht angemeldet“
