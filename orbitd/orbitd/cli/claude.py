"""Claude Code: `claude -p` mit stream-json. Eingebaute Werkzeuge sind aus; alles läuft über Orbits MCP-Werkzeuge."""
import json
import os
import tempfile
from pathlib import Path
from typing import AsyncIterator

from ..redact import redact
from .base import Adapter, CliError, Ev, ProcessTree, Turn, base_env


def limits_from(info: dict) -> dict:
    """rate_limit_event -> einheitliche Form für Jev (Live-Limits)."""
    windows = [{"name": {"five_hour": "5h", "seven_day": "7d"}.get(name, name), "used": w.get("utilization", 0), "resetAt": (w.get("resetsAt") or 0) * 1000}
               for name, w in (info.get("unifiedWindows") or {}).items()]
    return {"windows": windows, "blocked": info.get("status") not in (None, "allowed", "allowed_warning")}


class Claude(Adapter):
    name, binary, label = "claude", "claude", "Claude Code"
    keychain = True  # liest seine Anmeldung mit `security find-generic-password` (Doku: Zugang liegt unter macOS im Schlüsselbund)

    @staticmethod
    def mcp_file(turn: Turn) -> Path:
        """Das Lauf-Token steht nicht auf der Befehlszeile (ps), sondern in einer Datei mit Rechten 0600 im Arbeitsordner des Laufs.
        Ob `${ORBIT_RUN_TOKEN}` in --mcp-config aufgelöst wird, ist nicht belegt (claude lag beim Prüfen nicht vor)."""
        turn.cwd.mkdir(parents=True, exist_ok=True)
        fd, name = tempfile.mkstemp(prefix=".orbit-mcp-", suffix=".json", dir=turn.cwd)  # mkstemp: Rechte 0600
        mcp = {"mcpServers": {"orbit": {"type": "http", "url": turn.mcp_url, "headers": {"Authorization": f"Bearer {turn.run_token}"}}}}
        with os.fdopen(fd, "w") as f:
            json.dump(mcp, f)
        return Path(name)

    def command(self, turn: Turn, mcp_file: Path | None = None) -> list[str]:
        mcp_file = mcp_file or self.mcp_file(turn)
        argv = [*self.argv0(), "-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
                "--include-partial-messages", "--model", turn.model, "--setting-sources", "", "--strict-mcp-config",
                "--mcp-config", str(mcp_file), "--tools", "", "--allowedTools", "mcp__orbit", "--disable-slash-commands",
                "--system-prompt", turn.system]
        if turn.effort:
            argv += ["--effort", turn.effort]
        if turn.session:
            argv += ["--resume", turn.session]
        return argv

    async def run(self, turn: Turn, tree_ready) -> AsyncIterator[Ev]:
        mcp_file = self.mcp_file(turn)
        try:
            async for ev in self._run(turn, tree_ready, mcp_file):
                yield ev
        finally:
            mcp_file.unlink(missing_ok=True)

    async def _run(self, turn: Turn, tree_ready, mcp_file: Path) -> AsyncIterator[Ev]:
        tree = await ProcessTree.spawn(self.command(turn, mcp_file), turn.cwd, base_env(turn), self.keychain)
        tree_ready(tree)
        # Bilder vor dem Text (wie lib/cli/adapters.ts): Claude sieht Anhänge und Screenshots.
        content = [{"type": "image", "source": {"type": "base64", "media_type": img["mediaType"], "data": img["base64"]}}
                   for img in (turn.images or []) if isinstance(img, dict) and img.get("base64") and img.get("mediaType")]
        content.append({"type": "text", "text": turn.prompt})
        message = {"type": "user", "message": {"role": "user", "content": content}}
        await tree.send(json.dumps(message) + "\n", close=True)
        tools: dict[str, str] = {}  # tool_use_id -> Name
        finished = False
        async for line in tree.lines():
            try:
                e = json.loads(line)
            except ValueError:
                continue
            kind = e.get("type")
            if kind == "system" and e.get("subtype") == "init":
                yield Ev("session", {"id": e.get("session_id"), "model": e.get("model")})
            elif kind == "stream_event":
                delta = (e.get("event") or {}).get("delta") or {}
                if delta.get("type") == "text_delta":
                    yield Ev("text", {"delta": delta.get("text", "")})
                elif delta.get("type") == "thinking_delta":
                    yield Ev("think", {"delta": delta.get("thinking", "")})
            elif kind == "assistant":
                for block in (e.get("message") or {}).get("content") or []:
                    if block.get("type") == "tool_use":
                        tools[block["id"]] = block.get("name", "")
                        yield Ev("tool_start", {"id": block["id"], "name": block.get("name", ""), "input": block.get("input") or {}})
            elif kind == "user":
                for block in (e.get("message") or {}).get("content") or []:
                    if isinstance(block, dict) and block.get("type") == "tool_result":
                        yield Ev("tool_end", {"id": block.get("tool_use_id"), "name": tools.get(block.get("tool_use_id"), ""),
                                              "ok": not block.get("is_error"), "output": block.get("content")})
            elif kind == "rate_limit_event":
                yield Ev("limits", limits_from(e.get("rate_limit_info") or {}))
            elif kind == "result":
                finished = True
                usage = e.get("usage") or {}
                yield Ev("usage", {"inputTokens": usage.get("input_tokens", 0) + usage.get("cache_read_input_tokens", 0) + usage.get("cache_creation_input_tokens", 0),
                                   "outputTokens": usage.get("output_tokens", 0), "cachedTokens": usage.get("cache_read_input_tokens", 0),
                                   "costUsd": e.get("total_cost_usd")})
                if e.get("is_error") or e.get("subtype") != "success":
                    yield Ev("error", {"text": explain(str(e.get("result") or e.get("subtype") or ""))})
                else:
                    yield Ev("done", {"reason": e.get("stop_reason") or "stop"})
        code = await tree.proc.wait()
        if not finished:
            raise CliError(explain(await tree.stderr_tail()) if code else "Claude hat ohne Ergebnis aufgehört.")


def explain(raw: str) -> str:
    raw = redact(raw)
    low = raw.lower()
    if "login" in low or "authenticat" in low or "api key" in low:
        return "Claude ist nicht angemeldet. Melde dich im Terminal mit „claude auth login“ an."
    if "limit" in low:
        return "Claude hat gerade sein Nutzungslimit erreicht."
    return f"Claude konnte nicht antworten. ({raw.strip()[:200]})" if raw.strip() else "Claude konnte nicht antworten."
