"""User-visible deliveries through the durable work ledger."""
import re
from urllib.parse import urlsplit

from ..runtime import ledger
from ..runtime.contract import tool
from ..web import Fail
from .core import _no_background

_OPTION = {"type": "object", "additionalProperties": False, "properties": {
    "id": {"type": "string"}, "value": {"type": "string", "minLength": 1}, "label": {"type": "string", "minLength": 1},
    "description": {"type": "string"}, "style": {"enum": ["default", "primary", "danger"]}},
    "required": ["label"]}
_WIDGET = {"type": "object", "additionalProperties": False, "properties": {
    "id": {"type": "string"}, "prompt": {"type": "string"},
    "options": {"type": "array", "items": _OPTION, "minItems": 1, "maxItems": 6},
    "multiple": {"type": "boolean"}, "multiSelect": {"type": "boolean"},
    "dismissOnMoveOn": {"type": "boolean"}, "helpText": {"type": "string", "minLength": 1},
    "allowCustom": {"type": "boolean"},
    "customPlaceholder": {"type": "string"}}, "required": ["options"]}


def normalize_widget(raw) -> dict | None:
    """1–6 labelled options; stable ids so a later answer can be checked. Anything else is rejected."""
    if not isinstance(raw, dict) or not isinstance(raw.get("options"), list):
        return None
    options = []
    for i, item in enumerate(raw["options"][:6]):
        if isinstance(item, str):
            item = {"label": item}
        if not isinstance(item, dict) or not isinstance(item.get("label"), str) or not item["label"].strip():
            continue
        opt = {"id": item["id"] if isinstance(item.get("id"), str) and item["id"] else f"o{i}",
               "label": item["label"].strip()}
        if any(existing["id"] == opt["id"] for existing in options):
            return None
        if isinstance(item.get("value"), str) and item["value"].strip():
            opt["value"] = item["value"]
        if isinstance(item.get("description"), str) and item["description"].strip():
            opt["description"] = item["description"].strip()
        if item.get("style") in ("primary", "danger"):
            opt["style"] = item["style"]
        options.append(opt)
    if not options:
        return None
    out = {"options": options}
    if isinstance(raw.get("id"), str) and raw["id"]:
        out["id"] = raw["id"]
    if isinstance(raw.get("prompt"), str) and raw["prompt"].strip():
        out["prompt"] = raw["prompt"].strip()
    if isinstance(raw.get("helpText"), str) and raw["helpText"].strip():
        out["helpText"] = raw["helpText"].strip()
    if isinstance(raw.get("dismissOnMoveOn"), bool):
        out["dismissOnMoveOn"] = raw["dismissOnMoveOn"]
    if raw.get("multiSelect", raw.get("multiple")):
        out["multiple"] = True
    if raw.get("allowCustom"):
        out["allowCustom"] = True
    if isinstance(raw.get("customPlaceholder"), str) and raw["customPlaceholder"].strip():
        out["customPlaceholder"] = raw["customPlaceholder"].strip()
    return out


def _https_image(image: dict) -> dict:
    try:
        url = urlsplit(image["url"])
        valid = url.scheme == "https" and url.hostname and url.username is None and url.password is None
    except (KeyError, TypeError, ValueError):
        valid = False
    if not valid:
        raise Fail("An inline image requires an HTTPS URL without credentials.")
    return {"url": image["url"], "alt": image.get("alt") or "Image"}


def _safe_account_part(value: str, *, max_len: int = 80) -> str | None:
    value = value.strip()
    if not value or len(value) > max_len or not all(c.isalnum() or c in "_-." for c in value):
        return None
    return value


def normalize_secret(raw) -> dict | None:
    """Owner-only secure field: stable name for storage, label for the card. Value never travels in the tool result."""
    if not isinstance(raw, dict):
        return None
    name = _safe_account_part(raw["name"]) if isinstance(raw.get("name"), str) else None
    label = raw.get("label")
    if not name or not isinstance(label, str) or not label.strip():
        return None
    out = {"name": name, "label": label.strip()}
    if isinstance(raw.get("description"), str) and raw["description"].strip():
        out["description"] = raw["description"].strip()[:400]
    if isinstance(raw.get("plugin_id"), str):
        plugin = _safe_account_part(raw["plugin_id"])
        if plugin:
            out["plugin_id"] = plugin
    return out


def secret_account(secret: dict) -> str:
    if secret.get("plugin_id"):
        return f"plugin.{secret['plugin_id']}.{secret['name']}"
    return f"secret.{secret['name']}"


@tool("SendToUser", "Publish Markdown text, inline images, a sandbox attachment, a choice card, a Cursor cloud-agent reference or a secure-input request "
      "to the current conversation. Set end_turn on the final delivery. Reference an existing Cursor cloud agent by its bcId. For a spoken memo use type=text and voice_memo=true as the only delivery. "
      "secret-request is ONLY for pasting a raw secret (API key, token, password text). Never use it to connect OAuth plugins (Gmail, Slack, …) — use InstallPlugin instead.",
      {"type": "object", "additionalProperties": False, "properties": {
          "type": {"enum": ["text", "attachment", "widget", "cursor-agent", "secret-request"]},
          "content": {"type": "string"}, "end_turn": {"type": "boolean"}, "voice_memo": {"type": "boolean"},
          "alt": {"type": "string"}, "bcId": {"type": "string"}, "channel": {"type": "string"},
          "reply_to": {"type": "string"}, "to": {"enum": ["dm"]},
          "images": {"type": "array", "items": {"type": "object", "required": ["url"], "additionalProperties": False,
                      "properties": {"url": {"type": "string"}, "alt": {"type": "string"}}}},
          "secret": {"type": "object", "additionalProperties": False, "properties": {
              "description": {"type": "string"}, "label": {"type": "string"}, "name": {"type": "string"},
              "plugin_id": {"type": "string"}}, "required": ["label", "name"]},
          "widget": _WIDGET}},
      available=_no_background)
async def send_to_user(run, args):
    if args.get("voice_memo"):
        from .memo import send_memo
        return await send_memo(run, args)
    kind = args.get("type") or (
        "widget" if "widget" in args else ("secret-request" if "secret" in args else "text"))
    content = args.get("content", "")
    images = [_https_image(image) for image in args.get("images", [])]
    widget = normalize_widget(args["widget"]) if "widget" in args else None
    secret = normalize_secret(args.get("secret")) if kind == "secret-request" or "secret" in args else None
    if kind == "widget" and widget is None and "widget" not in args:
        raise Fail("A choice needs 1 to 6 options with a label.")
    if "widget" in args and widget is None:
        raise Fail("A choice needs 1 to 6 options with a label.")
    if kind == "secret-request":
        if getattr(run, "chat_kind", None) != "direct":
            raise Fail("Secure input can only be requested in your own chat.")
        if secret is None:
            raise Fail("secret-request needs a secret with label and a safe name.")
    end_turn = args.get("end_turn", False)
    if kind == "attachment":
        path = (content or "").strip() or (images[0]["url"] if images else "")
        if not path or path.startswith("http://") or path.startswith("https://"):
            raise Fail("attachment needs a sandbox file path in content (not an http URL).")
        from .daytona import share_file
        note = await share_file(run, {"path": path})
        return {"ok": True, "shared": note, "end_turn": end_turn}
    key = f"{run.id}:send:{run.attempt}:{run.sent + 1}"
    try:
        if kind == "cursor-agent":
            agent_id = args.get("bcId")
            if not isinstance(agent_id, str) or not re.fullmatch(r"bc-[A-Za-z0-9][A-Za-z0-9_-]{0,127}", agent_id):
                raise Fail("A Cursor cloud agent reference needs its bc- identifier.")
            if any(args.get(field) for field in ("channel", "reply_to", "to")):
                raise Fail("This Cursor reference can only be delivered to the current chat.")
            link = f"[Cursor cloud agent · {agent_id}](https://cursor.com/agents/{agent_id})"
            message = f"{content.strip()}\n\n{link}" if content.strip() else link
            row = run.publish("cloud-job", [{"type": "text", "text": message}], key=key, end_turn=end_turn)
        elif secret is not None and kind == "secret-request":
            card_input = {"secret": secret}
            if isinstance(content, str) and content.strip():
                card_input["markdown"] = content
            row = run.publish("secret-request", [{"type": "secret-request", **card_input}], key=key,
                              end_turn=end_turn, card_input=card_input)
        elif widget is not None:
            card_input = {"widget": widget}
            if isinstance(content, str) and content.strip():
                card_input["markdown"] = content
            if images:
                card_input["images"] = [{"url": i["url"], "alt": i["alt"]} for i in images]
            row = run.publish("widget", [{"type": "widget", **card_input}], key=key, end_turn=end_turn,
                              card_input=card_input)
        else:
            parts = []
            if isinstance(content, str) and content.strip():
                parts.append({"type": "text", "text": content})
            for image in images:
                parts.append({"type": "file", "url": image["url"], "mediaType": "image/*", "filename": image["alt"]})
            if not parts:
                raise Fail("Provide text, at least one image, a choice, or a secret request.")
            row = run.publish("text", parts, key=key, end_turn=end_turn)
    except ledger.LedgerError as exc:
        raise Fail(str(exc)) from None
    return {"ok": True, "deliveryId": row["id"]}
