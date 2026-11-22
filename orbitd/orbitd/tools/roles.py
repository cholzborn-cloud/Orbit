"""Role-to-capability manifest (Word sections 2.1, 2.2 and 1.14). Applied by the bridge on tools/list AND tools/call.

Every tool has a capability class. Some tools decide their class from the real arguments (an action field), so a
read-only role can read a file with mac_files but never write one. Unknown tools are denied in restricted roles.
Dynamic MCP and connector tools are always "external": a server's own read-only hint is external content and never
grants anything.

Roles come from work_runs.role (NULL = foreground, contract.ROLES).
"""
from ..runtime import contract

# capability classes
READ, USER, LOCAL, SHELL, GUI, TAKEOVER, EXTERNAL, DELEGATE, REPORT, DRAFT = (
    "read", "user", "local", "shell", "gui", "takeover", "external", "delegate", "report", "draft")
CLASSES = (READ, USER, LOCAL, SHELL, GUI, TAKEOVER, EXTERNAL, DELEGATE, REPORT, DRAFT)

STATIC = {
    # read-only lookups
    "brain_search": READ, "brain_read": READ, "memory_get": READ, "chat_recall": READ, "read_skill": READ,
    "read_coding_rules": READ, "web_search": READ, "apple_calendar_list": READ, "apple_reminders_list": READ,
    "connector_plugins__search": READ, "list_orbis": READ, "read_file": READ, "list_files": READ, "computer_status": READ,
    "mac_contacts": READ, "mac_screen": READ, "view_screen": READ, "wait": READ,
    "RecallMemory": READ, "ListSections": READ, "ListAgents": READ, "ListMachines": READ,
    "WebSearch": READ, "WebFetch": READ,
    "GetDynamicTools": READ, "SearchPlugins": READ, "GetPlugin": READ, "GetMcpServerStatus": READ,
    "GetMcpTools": READ, "ReadSkill": READ, "CloudAgent": DELEGATE,
    # messages to the user in this chat
    "SendToUser": USER, "say": USER, "ask_user": USER, "react": USER, "show_screen": USER,
    "ReactToMessage": USER, "SendFeedback": USER,
    # background workers and durable todos
    "Task": DELEGATE, "CheckSubagent": READ, "MessageSubagent": LOCAL, "StopSubagent": LOCAL, "TodoWrite": LOCAL,
    # local Orbit or workspace changes
    "memory_save": LOCAL, "memory_forget": LOCAL, "automation_create": LOCAL, "onboarding_finish": LOCAL,
    "save_skill": LOCAL, "create_pdf": LOCAL, "create_word": LOCAL, "write_file": LOCAL, "create_file": LOCAL,
    "share_file": USER, "brain_write": LOCAL, "brain_move": LOCAL, "apple_calendar_create": LOCAL,
    "apple_calendar_create_many": LOCAL, "apple_calendar_update": LOCAL, "apple_calendar_delete": LOCAL,
    "apple_calendar_delete_many": LOCAL, "apple_reminders_create": LOCAL, "update_orbi": LOCAL, "archive_orbi": LOCAL,
    "mac_notify": LOCAL, "computer_wake": LOCAL, "computer_sleep": LOCAL, "test_spend": EXTERNAL,
    "UpdateMemory": LOCAL, "UpdateRoutine": LOCAL, "UpdateSkill": LOCAL, "UpdateProfile": LOCAL, "UpdateAvatar": LOCAL,
    "UpdateAgent": LOCAL, "SetMcpInstructions": LOCAL, "RestartMcpServers": LOCAL,
    # shell and scripting
    "mac_shell": SHELL, "bash": SHELL, "mac_applescript": SHELL, "mac_shortcut": SHELL,
    "Shell": SHELL, "AwaitShell": READ, "Read": READ, "Screenshot": READ,
    "CopyToBox": LOCAL, "CopyFromBox": LOCAL, "request_box_help": TAKEOVER,
    # GUI and browser driving
    "mac_input": GUI, "mac_open": GUI, "mouse_click": GUI, "mouse_move": GUI, "mouse_scroll": GUI, "mouse_drag": GUI,
    "keyboard_type": GUI, "keyboard_press": GUI, "keyboard_hotkey": GUI,
    # device takeover and login
    "request_computer_takeover": TAKEOVER, "AuthenticateMcpServer": TAKEOVER,
    # external effects (messages, connectors, plugins)
    "connector_plugins__execute": EXTERNAL, "apple_calendar_invite": EXTERNAL, "CallDynamicTool": EXTERNAL,
    "CallMcpTool": EXTERNAL, "InstallPlugin": EXTERNAL, "AddMcpServer": EXTERNAL, "UninstallMcpServer": EXTERNAL,
    "UninstallPlugin": EXTERNAL,
    # delegation to other Orbis
    "send_message": DELEGATE, "create_orbi": DELEGATE, "CreateAgent": DELEGATE, "SendToAgent": DELEGATE,
    # private result to the originator
    "report_handoff": REPORT,
}

READ_ACTIONS = {
    "mac_files": ("read", "list", "search"),
    "mac_calendar": ("list",),
    "mac_reminders": ("list",),
    "mac_notes": ("search", "read"),
    "mac_clipboard": ("read",),
    "update_routine": ("read", "list"),
}


def capability(name: str, args) -> str | None:
    """Class of this call. None = unknown tool (denied in restricted roles)."""
    if name.startswith(("mcp_", "connector_")) and name not in STATIC:
        return EXTERNAL
    if name == "mac_browser":
        return GUI
    if name in READ_ACTIONS:
        action = args.get("action") if isinstance(args, dict) else None
        if action is None:  # listing: the tool as a whole, its widest use
            return LOCAL
        return READ if action in READ_ACTIONS[name] else LOCAL
    return STATIC.get(name)


# Allowed classes per role. A role missing here is unrestricted (foreground behaviour).
ALLOWED = {
    # headless executor: no browser driving, no messages to the user, no external drafts, no delegation
    "executor": {READ, LOCAL, SHELL, REPORT},
    # read-only executor: no mutation at all, also not through nested shell, GUI or dynamic tools
    "readonly": {READ, REPORT},
}
DENIED = {
    # group member: no device takeover or login
    "group": {TAKEOVER},
}
LISTED_READ_ONLY = {"mac_files", "mac_calendar", "mac_reminders", "mac_notes", "mac_clipboard", "update_routine"}


def role_of(run) -> str:
    role = getattr(run, "role", None)
    if role is None:
        try:
            role = run.ctx.db.val("SELECT role FROM work_runs WHERE id=?", run.id)
        except Exception:
            return "unknown"
    if getattr(run, "chat_kind", None) == "group" and role in (None, "foreground"):
        role = "group"
    return "foreground" if role is None else role


def allowed(role: str, name: str, args=None, *, listing: bool = False) -> bool:
    if role not in contract.ROLES:
        return False
    if role in ALLOWED:
        if listing and role == "readonly" and name in LISTED_READ_ONLY:
            return True  # listed; each call is checked with its real action
        cls = capability(name, args if args is not None else {})
        return cls in ALLOWED[role]
    if role in DENIED:
        return capability(name, args if args is not None else {}) not in DENIED[role]
    return True


def refusal(role: str, name: str) -> str:
    return f"The {role} role may not use {name}. Report back to the originator instead."
