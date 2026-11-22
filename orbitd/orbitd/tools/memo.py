"""Produce the single local audio delivery requested by SendToUser(voice_memo=true)."""
import asyncio
import base64
from pathlib import Path
import tempfile
import wave

from ..runtime import ledger
from ..web import Fail

VOICE = Path(__file__).resolve().parents[3] / "voice"


async def _execute(*command, input_bytes=None):
    process = await asyncio.create_subprocess_exec(
        *command, stdin=asyncio.subprocess.PIPE if input_bytes else asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL)
    try:
        async with asyncio.timeout(180):
            await process.communicate(input_bytes)
    finally:
        if process.returncode is None:
            try:
                process.kill()
            except ProcessLookupError:
                pass
            await process.wait()
    if process.returncode:
        raise Fail("Orbit could not create this memo with its local voice model. Please retry.")


async def render(text):
    if not (VOICE / "voice-memo").is_file():
        raise Fail("The local voice model is missing. Reinstall the complete Orbit app to restore it.")
    with tempfile.TemporaryDirectory(prefix="orbit-memo-") as temp:
        wav = Path(temp) / "memo.wav"
        audio = Path(temp) / "memo.m4a"
        try:
            await _execute(VOICE / "voice-memo", VOICE, wav, input_bytes=text.encode())
            with wave.open(str(wav)) as source:
                duration = round(1000 * source.getnframes() / source.getframerate())
            await _execute("/usr/bin/afconvert", "-f", "m4af", "-d", "aac", "-b", "48000", wav, audio)
            data = audio.read_bytes()
            if not data or not duration:
                raise ValueError("empty audio")
        except (OSError, ValueError, wave.Error, EOFError, TimeoutError):
            raise Fail("The local voice model could not finish this memo. Please retry.") from None
    return {"type": "memo", "mediaType": "audio/mp4", "durationMs": duration,
            "url": "data:audio/mp4;base64," + base64.b64encode(data).decode("ascii")}


async def send_memo(run, args):
    if args.get("type", "text") != "text" or any(k in args for k in ("channel", "images", "widget", "secret", "to", "bcId", "reply_to")):
        raise Fail("A voice memo must contain only spoken text for the current conversation.")
    text = args.get("content")
    if not isinstance(text, str) or not text.strip() or len(text) > 4000 or "\x00" in text:
        raise Fail("A voice memo needs 1 to 4,000 characters of spoken text.")
    if run.sent or run.end_turn:
        raise Fail("The voice memo must be the first and only delivery in the turn.")
    part = await render(text.strip())
    # Concurrent tool calls may have delivered something while synthesis was running.
    if run.sent or run.end_turn:
        raise Fail("Another delivery already completed in this turn.")
    try:
        row = run.publish("memo", [part], key=f"{run.id}:send:{run.attempt}:1", end_turn=True)
    except ledger.LedgerError as exc:
        raise Fail(str(exc)) from None
    return {"ok": True, "deliveryId": row["id"]}
