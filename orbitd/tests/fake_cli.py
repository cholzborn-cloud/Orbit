"""Attrappen-CLI mit vier Dialekten (claude, codex, cursor, agy). Idee: regnull/openbot tests/fake_claude.py.

Gesteuert über die Datei $ORBIT_FAKE_SCRIPT (JSON) oder Marken im Prompt:
  text      Antworttext (Standard: „Antwort auf: <prompt-ende>“)
  sleep     Sekunden Pause vor der Antwort
  hang      true = hängt für immer (Stopp-Test)
  child     true = startet einen Kindprozess, der weiterläuft (Stopp muss ihn mit beenden); PID nach $ORBIT_FAKE_PIDFILE
  tool      {"name":…, "arguments":{…}} = ruft dieses Orbit-Werkzeug echt über MCP auf (HTTP, Lauf-Token)
  exit      Exit-Code ohne Ergebnis (Fehlerfall)
  limit     true = meldet Nutzungslimit
Marken im Prompt: [[sleep:2]] [[hang]] [[child]] [[exit:1]] [[limit]] [[tool:name {json}]]
Jeder Aufruf wird nach $ORBIT_FAKE_LOG geschrieben (argv ohne Token), damit Tests Modell und Sitzung prüfen können.
"""
import argparse
import json
import os
import re
import subprocess
import sys
import time
import urllib.request
import uuid


def out(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def load_script(prompt: str) -> dict:
    script = {}
    path = os.environ.get("ORBIT_FAKE_SCRIPT")
    if path and os.path.exists(path):
        script = json.load(open(path))
    for key, value in re.findall(r"\[\[(\w+)(?::([^\]]*))?\]\]", prompt):
        if key == "tool":
            name, _, args = value.partition(" ")
            script["tool"] = {"name": name, "arguments": json.loads(args or "{}")}
        elif key in ("sleep",):
            script[key] = float(value)
        elif key == "exit":
            script[key] = int(value)
        else:
            script[key] = True
    return script


def mcp_call(name: str, arguments: dict) -> dict:
    """Echter MCP-Aufruf (JSON-RPC über HTTP) an Orbits Werkzeug-Brücke."""
    url, token = os.environ["ORBIT_MCP_URL"], os.environ["ORBIT_RUN_TOKEN"]

    def rpc(method, params, rid):
        body = json.dumps({"jsonrpc": "2.0", "id": rid, "method": method, "params": params}).encode()
        req = urllib.request.Request(url, body, {"Content-Type": "application/json", "Accept": "application/json, text/event-stream", "Authorization": f"Bearer {token}"})
        with urllib.request.urlopen(req, timeout=120) as resp:
            return json.load(resp)

    rpc("initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "fake", "version": "1"}}, 1)
    return rpc("tools/call", {"name": name, "arguments": arguments}, 2).get("result", {})


def behave(script: dict, prompt: str):
    """Gemeinsames Verhalten; liefert (Text, Werkzeug-Ergebnis | None)."""
    if script.get("child"):
        child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(600)"])
        if os.environ.get("ORBIT_FAKE_PIDFILE"):
            open(os.environ["ORBIT_FAKE_PIDFILE"], "w").write(str(child.pid))
    if script.get("hang"):
        time.sleep(3600)
    if script.get("sleep"):
        time.sleep(script["sleep"])
    if "exit" in script:
        sys.stderr.write("fake: kaputt\n")
        sys.exit(script["exit"])
    tool_result = None
    if script.get("tool"):
        tool_result = mcp_call(script["tool"]["name"], script["tool"]["arguments"])
    clean = re.sub(r"\[\[[^\]]*\]\]", "", prompt).strip()
    return script.get("text") or f"Antwort auf: {clean[-80:]}", tool_result


def log_call(dialect: str, argv: list[str], extra: dict):
    path = os.environ.get("ORBIT_FAKE_LOG")
    if path:
        safe = [a if "Bearer" not in a else "<mcp>" for a in argv]
        open(path, "a").write(json.dumps({"dialect": dialect, "argv": safe, **extra}) + "\n")


def claude(argv):
    p = argparse.ArgumentParser()
    p.add_argument("--model"), p.add_argument("--resume")
    args, _ = p.parse_known_args(argv)
    message = json.loads(sys.stdin.readline())
    prompt = message["message"]["content"][0]["text"]
    script = load_script(prompt)
    session = args.resume or str(uuid.uuid4())
    log_call("claude", argv, {"model": args.model, "session": args.resume, "prompt": prompt})
    out({"type": "system", "subtype": "init", "session_id": session, "model": args.model})
    if script.get("limit"):
        out({"type": "rate_limit_event", "rate_limit_info": {"status": "rejected", "unifiedWindows": {"five_hour": {"utilization": 1.0, "resetsAt": int(time.time()) + 3600}}}})
        out({"type": "result", "subtype": "error", "is_error": True, "result": "usage limit reached", "usage": {}})
        return
    out({"type": "rate_limit_event", "rate_limit_info": {"status": "allowed", "unifiedWindows": {"five_hour": {"utilization": 0.2, "resetsAt": int(time.time()) + 3600}}}})
    if script.get("tool"):
        out({"type": "assistant", "message": {"content": [{"type": "tool_use", "id": "tu1", "name": "mcp__orbit__" + script["tool"]["name"], "input": script["tool"]["arguments"]}]}})
    text, tool_result = behave(script, prompt)
    if tool_result is not None:
        out({"type": "user", "message": {"content": [{"type": "tool_result", "tool_use_id": "tu1", "is_error": bool(tool_result.get("isError")), "content": tool_result.get("content")}]}})
    for word in re.findall(r"\S+\s*", text):
        out({"type": "stream_event", "event": {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": word}}})
    out({"type": "result", "subtype": "success", "is_error": False, "stop_reason": "end_turn", "total_cost_usd": 0.001,
         "usage": {"input_tokens": 10, "output_tokens": 5, "cache_read_input_tokens": 0, "cache_creation_input_tokens": 0}})


def codex(argv):
    session, model = None, None
    for line in sys.stdin:
        m = json.loads(line)
        method, rid, params = m.get("method"), m.get("id"), m.get("params") or {}
        if method == "initialize":
            out({"id": rid, "result": {}})
        elif method in ("thread/start", "thread/resume"):
            session, model = params.get("threadId"), params.get("model")
            out({"id": rid, "result": {"thread": {"id": session or str(uuid.uuid4())}}})
        elif method == "turn/start":
            assert params["model"] == model
            prompt = params["input"][0]["text"]
            script = load_script(prompt)
            log_call("codex", argv, {"model": model, "session": session, "prompt": prompt})
            out({"id": rid, "result": {"turn": {"status": "inProgress"}}})
            if script.get("limit"):
                out({"method": "turn/completed", "params": {"turn": {"status": "failed", "error": {"message": "You've hit your usage limit. try again at 11:38 PM."}}}})
                return
            if script.get("tool"):
                out({"method": "item/started", "params": {"item": {"id": "i1", "type": "mcpToolCall", "server": "orbit", "tool": script["tool"]["name"], "arguments": script["tool"]["arguments"]}}})
            text, tool_result = behave(script, prompt)
            if tool_result is not None:
                out({"method": "item/completed", "params": {"item": {"id": "i1", "type": "mcpToolCall", "server": "orbit", "tool": script["tool"]["name"], "result": tool_result, "status": "completed"}}})
            for i in range(0, len(text), 5):
                out({"method": "item/agentMessage/delta", "params": {"itemId": "i2", "delta": text[i:i + 5]}})
            out({"method": "item/completed", "params": {"item": {"id": "i2", "type": "agentMessage", "text": text}}})
            out({"method": "thread/tokenUsage/updated", "params": {"tokenUsage": {"last": {"inputTokens": 10, "outputTokens": 5, "cachedInputTokens": 0}}}})
            out({"method": "turn/completed", "params": {"turn": {"status": "completed"}}})
            return


def acp(dialect, argv):
    session, model = None, None
    for line in sys.stdin:
        m = json.loads(line)
        method, rid, params = m.get("method"), m.get("id"), m.get("params") or {}
        if method == "initialize":
            out({"jsonrpc": "2.0", "id": rid, "result": {"protocolVersion": 1, "agentCapabilities": {"loadSession": True}}})
        elif method in ("session/new", "session/load"):
            session = params.get("sessionId") or str(uuid.uuid4())
            result = {"sessionId": session}
            if dialect == "cursor":
                result["models"] = {"availableModels": [
                    {"modelId": "auto", "name": "Auto"},
                    {"modelId": "composer-test[fast=true]", "name": "Composer Fast"},
                    {"modelId": "composer-test", "name": "Composer"},
                ]}
            out({"jsonrpc": "2.0", "id": rid, "result": result})
        elif method == "session/set_model":
            model = params.get("modelId")
            out({"jsonrpc": "2.0", "id": rid, "result": {}})
        elif method == "session/prompt":
            prompt = params["prompt"][0]["text"]
            script = load_script(prompt)
            log_call(dialect, argv, {"model": model, "session": session, "prompt": prompt})
            if script.get("limit"):
                out({"jsonrpc": "2.0", "id": rid, "error": {"code": -32000, "message": "quota limit reached"}})
                continue
            if script.get("tool"):
                out({"jsonrpc": "2.0", "method": "session/update", "params": {"sessionId": session, "update": {"sessionUpdate": "tool_call", "toolCallId": "t1", "title": "orbit: " + script["tool"]["name"], "rawInput": script["tool"]["arguments"]}}})
            text, tool_result = behave(script, prompt)
            if tool_result is not None:
                out({"jsonrpc": "2.0", "method": "session/update", "params": {"sessionId": session, "update": {"sessionUpdate": "tool_call_update", "toolCallId": "t1", "status": "completed", "rawOutput": tool_result}}})
            for word in re.findall(r"\S+\s*", text):
                out({"jsonrpc": "2.0", "method": "session/update", "params": {"sessionId": session, "update": {"sessionUpdate": "agent_message_chunk", "content": {"type": "text", "text": word}}}})
            out({"jsonrpc": "2.0", "id": rid, "result": {"stopReason": "end_turn", "usage": {"inputTokens": 10, "outputTokens": 5}}})


if __name__ == "__main__":
    dialect, argv = sys.argv[2], sys.argv[3:]
    {"claude": claude, "codex": codex}.get(dialect, lambda a: acp(dialect, a))(argv)
