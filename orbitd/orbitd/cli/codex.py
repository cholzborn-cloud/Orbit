"""Codex app-server: fortsetzbare Sitzungen mit Text-Deltas während des Schreibens."""
import json
import os
import re
from pathlib import Path
from typing import AsyncIterator

from ..redact import redact
from .base import Adapter, CliError, Ev, ProcessTree, Turn, base_env


async def codex_request(argv: list[str], method: str, params: dict | None, *, keychain_api: bool = False) -> dict | None:
    tree = await ProcessTree.spawn([*argv, "app-server"], Path("/tmp"), dict(os.environ), keychain_api=keychain_api)
    try:
        await tree.send(json.dumps({"id": 1, "method": "initialize", "params": {"clientInfo": {"name": "orbit", "version": "1"}}}) + "\n")
        async for line in tree.lines(trace=False):
            message = json.loads(line)
            if message.get("id") == 1:
                if message.get("error"):
                    return None
                await tree.send(json.dumps({"method": "initialized"}) + "\n")
                await tree.send(json.dumps({"id": 2, "method": method, "params": params}) + "\n")
            elif message.get("id") == 2:
                return None if message.get("error") else message.get("result")
        return None
    finally:
        await tree.kill()


class Codex(Adapter):
    name, binary, label = "codex", "codex", "Codex"
    keychain_api = True  # live belegt (13.11.): ohne Schlüsselbund-Dienste „workspace routing discovery failed“; `security` bleibt gesperrt

    def command(self, turn: Turn) -> list[str]:
        # Die CLI hat ein eigenes Profil (base_env). Der Orbit-MCP ist der einzige Weg zu Werkzeugen.
        argv = [*self.argv0(), "app-server", "-c", 'sandbox_mode="read-only"', "-c", 'approval_policy="never"',
                "-c", 'mcp_servers.orbit.default_tools_approval_mode="approve"',
                "--disable", "shell_tool", "--disable", "unified_exec",
                "-c", f"mcp_servers.orbit.url={json.dumps(turn.mcp_url)}",
                "-c", 'mcp_servers.orbit.bearer_token_env_var="ORBIT_RUN_TOKEN"',
                "-c", "mcp_servers.orbit.tool_timeout_sec=900"]
        if turn.effort:
            argv += ["-c", f"model_reasoning_effort={json.dumps(turn.effort)}"]
        if turn.fast:
            argv += ["-c", f"service_tier={json.dumps(turn.fast)}"]
        return argv

    async def run(self, turn: Turn, tree_ready) -> AsyncIterator[Ev]:
        tree = await ProcessTree.spawn(self.command(turn), turn.cwd, base_env(turn), self.keychain, self.keychain_api)
        tree_ready(tree)

        async def send(message: dict):
            await tree.send(json.dumps(message) + "\n")

        async def call(rid: int, method: str, params: dict):
            await send({"id": rid, "method": method, "params": params})

        thread = {"model": turn.model, "cwd": str(turn.cwd), "sandbox": "read-only", "approvalPolicy": "never",
                  "developerInstructions": turn.system}
        if turn.fast:
            thread["serviceTier"] = turn.fast
        seen: dict[str, str] = {}
        usage = None
        try:
            await call(1, "initialize", {"clientInfo": {"name": "orbit", "title": "Orbit", "version": "1"}})
            async for line in tree.lines():
                try:
                    event = json.loads(line)
                except ValueError:
                    continue
                rid, method = event.get("id"), event.get("method")
                if rid is not None and not method:
                    if "error" in event:
                        raise CliError(explain(str(event["error"].get("message") or "")))
                    result = event.get("result") or {}
                    if rid == 1:
                        await send({"method": "initialized"})
                        if turn.session:
                            await call(2, "thread/resume", {**thread, "threadId": turn.session})
                        else:
                            await call(2, "thread/start", thread)
                    elif rid == 2:
                        thread_id = result["thread"]["id"]
                        yield Ev("session", {"id": thread_id, "model": turn.model})
                        args = {"threadId": thread_id, "model": turn.model,
                                "input": [{"type": "text", "text": turn.prompt, "text_elements": []}]}
                        if turn.effort:
                            args["effort"] = turn.effort
                        if turn.fast:
                            args["serviceTier"] = turn.fast
                        await call(3, "turn/start", args)
                    continue
                if rid is not None:
                    await send({"id": rid, "error": {"code": -32601, "message": "Nicht unterstützt."}})
                    continue

                params = event.get("params") or {}
                if method == "item/agentMessage/delta":
                    item_id, delta = params.get("itemId", ""), params.get("delta", "")
                    if delta:
                        seen[item_id] = seen.get(item_id, "") + delta
                        yield Ev("text", {"delta": delta})
                elif method in ("item/started", "item/completed"):
                    item = params.get("item") or {}
                    done, what, item_id = method == "item/completed", item.get("type"), item.get("id", "")
                    if done and what == "agentMessage":
                        text = item.get("text") or ""
                        prefix = seen.pop(item_id, "")
                        if text.startswith(prefix) and len(text) > len(prefix):
                            yield Ev("text", {"delta": text[len(prefix):]})
                    elif done and what == "reasoning":
                        for summary in item.get("summary") or []:
                            yield Ev("think", {"delta": summary})
                    elif what in ("mcpToolCall", "commandExecution", "webSearch", "fileChange"):
                        name = item.get("tool") if what == "mcpToolCall" else what
                        if done:
                            yield Ev("tool_end", {"id": item_id, "name": name, "ok": item.get("status") not in ("failed", "declined") and not item.get("error"),
                                                  "output": item.get("result") or item.get("aggregatedOutput")})
                        else:
                            yield Ev("tool_start", {"id": item_id, "name": name, "input": item.get("arguments") or {}})
                elif method == "thread/tokenUsage/updated":
                    usage = (params.get("tokenUsage") or {}).get("last")
                elif method == "turn/completed":
                    result = params.get("turn") or {}
                    if result.get("status") != "completed":
                        raise CliError(explain(str((result.get("error") or {}).get("message") or result.get("status") or "")))
                    if usage:
                        yield Ev("usage", {"inputTokens": usage.get("inputTokens", 0), "outputTokens": usage.get("outputTokens", 0),
                                           "cachedTokens": usage.get("cachedInputTokens", 0), "costUsd": None})
                    yield Ev("done", {"reason": "stop"})
                    return
            raise CliError(explain(await tree.stderr_tail()))
        except CliError as error:
            if "nutzungslimit" in str(error).lower():
                yield Ev("limits", {"windows": [], "blocked": True, "note": str(error)[:200]})
            raise
        finally:
            await tree.kill()


def explain(raw: str) -> str:
    raw = redact(raw)
    low = raw.lower()
    if "usage limit" in low:
        again = re.search(r"try again at ([^.]+)", raw)
        return "Codex hat sein Nutzungslimit erreicht." + (f" Wieder frei ab {again.group(1).strip()}." if again else "")
    if "not supported" in low or "model_not_found" in low:
        return "Dieses Modell kann Codex mit deinem Konto nicht nutzen."
    if "login" in low or "unauthorized" in low:
        return "Codex ist nicht angemeldet. Melde dich im Terminal mit „codex login“ an."
    return f"Codex konnte nicht antworten. ({raw.strip()[:200]})" if raw.strip() else "Codex hat ohne Ergebnis aufgehört."
