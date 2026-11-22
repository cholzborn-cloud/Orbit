"""Start und Stopp der Hintergrundteile in fester Reihenfolge (Muster: regnull/openbot main.py)."""
import asyncio
import logging
import os

log = logging.getLogger("orbitd")


async def oneshot(runtime, prompt: str, tier: str = "small") -> str:
    """Ein Modellaufruf ohne Werkzeuge (Zusammenfassung u. Ä.): kleinstes verfügbares Modell der Stufe."""
    from . import cli
    models = [m for m in cli.MODELS if runtime.adapters[m["cli"]].available()]
    model = next((m for m in models if m["tier"] == tier), None) or next(iter(models), None)
    if not model:
        return ""
    from .db import dumps, new_id, now_ms
    from .runtime.recovery import proc_start
    db, adapter = runtime.ctx.db, runtime.adapters[model["cli"]]
    work = runtime.ctx.cfg.work_dir / f"oneshot-{new_id()}"
    turn = cli.Turn(prompt, "", model["model"], None, work, None, "", "")
    text, trees, keys = "", [], []

    def ready(tree) -> None:  # Prozessgruppe vermerken: nach kill -9 räumt der Wiederanlauf sie ab
        trees.append(tree)
        keys.append(f"oneshot:{tree.pgid}")
        db.run("INSERT OR REPLACE INTO app_kv (key,value,updated_at) VALUES (?,?,?)", keys[-1],
               dumps({"pgid": tree.pgid, "start": proc_start(tree.pgid), "proc": os.path.basename(adapter.fake) if adapter.fake else adapter.binary}), now_ms())

    try:
        async for ev in adapter.run(turn, ready):
            if ev.kind == "text":
                text += ev.data.get("delta", "")
    finally:
        for tree in trees:  # Zeitüberschreitung und Abbruch dürfen keinen Prozess zurücklassen
            await tree.kill()
        for key in keys:
            db.run("DELETE FROM app_kv WHERE key=?", key)
        for folder in (work, work.parent):  # leere Wegwerf-Ordner
            try:
                folder.rmdir()
            except OSError:
                pass
    return text.strip()


TICK_S = 30.0
SKIP_TOOLS = {"__init__", "bridge"}


def load_tools() -> None:
    """Werkzeug-Module einlesen. Kern ist Pflicht; alles andere unter tools/ tolerant: ein kaputtes Modul kostet nur eine Log-Zeile."""
    import importlib
    import pkgutil
    from . import tools
    from .tools import core, recall  # noqa: F401
    for mod in pkgutil.iter_modules(tools.__path__):
        if mod.name in SKIP_TOOLS or mod.name in ("core", "recall"):
            continue
        try:
            importlib.import_module(f"{tools.__name__}.{mod.name}")
        except Exception as e:
            log.warning("Werkzeug-Modul %s nicht geladen: %s", mod.name, e)


async def _expire_loop(interactions) -> None:
    while True:
        await asyncio.sleep(TICK_S)
        try:
            interactions.expire()
        except Exception:
            log.exception("Karten ablaufen lassen gescheitert")


async def start(ctx) -> None:
    """Reihenfolge: Limits, Jev, Karten, Brücke, Laufzeit (Wiederanlauf, dann Worker)."""
    from . import background, cli, context
    from .jev import Jev
    from .limits import Limits
    from .routes import models
    from .runtime.engine import Runtime
    from .runtime.interactions import Interactions
    from .tools.bridge import Bridge
    parts = ctx.parts
    if not ctx.cfg.fake_cli:
        cli.refresh()
    parts["adapters"] = cli.adapters(ctx.cfg.fake_cli)
    parts["limits"] = Limits(ctx)
    parts["jev"] = Jev(ctx)
    parts["interactions"] = interactions = Interactions(ctx)
    parts["bridge"] = Bridge(ctx)
    parts["health_checks"] = lambda: models.health_checks(ctx)
    parts["default_instructions"] = context.default_instructions
    load_tools()
    try:
        from .tools import user_mcp
        await user_mcp.start(ctx)  # Werkzeuge der eingetragenen MCP-Server; ein kaputter Server verhindert den Start nicht
    except Exception as e:
        log.warning("Eigene MCP-Server nicht gestartet: %s", e)
    parts["runtime"] = runtime = Runtime(ctx)
    parts["snapshot"] = runtime.snapshot
    parts["live_message_id"] = runtime.live_message_id
    parts["oneshot"] = lambda prompt, tier="small": oneshot(runtime, prompt, tier)
    from .tools import messages
    messages.start(ctx)  # automatische Antwort von Orbi zu Orbi
    background.start(ctx)  # stilles Gedächtnis nach dem Lauf
    from . import notices
    notices.start(ctx)  # System-Mitteilungen aus Bus-Ereignissen
    parts["expire_task"] = asyncio.create_task(_expire_loop(interactions))
    await runtime.start()  # Wiederanlauf vor den Workern
    from .runtime.timer import Timer
    parts["timer"] = timer = Timer(ctx, runtime)
    await timer.start()  # Zeitgeber der Routinen erst, wenn die Laufzeit steht
    try:
        from .tools.composio import composio
        if await composio.configured():
            asyncio.create_task(composio.toolkits())  # Marktplatz-Katalog im Hintergrund vorwärmen
    except Exception as e:
        log.warning("Plugin-Katalog nicht vorgewärmt: %s", e)
    log.info("orbitd (Python) gestartet auf Port %s, Daten: %s", ctx.cfg.port, ctx.cfg.data_dir)


async def stop(ctx) -> None:
    timer = ctx.parts.pop("timer", None)
    if timer:
        await timer.stop()
    task = ctx.parts.pop("expire_task", None)
    if task:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
    from . import background, notices
    notices.stop(ctx)
    await background.stop(ctx)
    if hasattr(ctx.parts.get("runtime"), "shutdown"):
        await ctx.parts["runtime"].shutdown()  # beendet auch alle CLI-Prozessgruppen
    if "setup" in ctx.parts:
        try:
            await ctx.parts["setup"].shutdown()  # laufende Installationen und Anmeldungen abbrechen
        except Exception:
            log.exception("Einrichtung nicht sauber beendet")
    log.info("orbitd beendet")
