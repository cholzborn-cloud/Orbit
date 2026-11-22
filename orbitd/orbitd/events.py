"""Ereignis-Bus für GET /v1/events. Muster: regnull/openbot runtime/bus.py (Queue je Abonnent).

Abweichung für Orbit: Snapshot zuerst, nur `data: {type}` ohne `event:`-Zeile, `: keepalive` alle 15 s,
zu langsame Leser werden getrennt (die App verbindet neu und bekommt wieder einen Snapshot).
"""
import asyncio
from typing import Callable

from starlette.responses import StreamingResponse

from .db import dumps

SSE_HEADERS = {"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"}


def sse(value) -> bytes:
    return f"data: {value if isinstance(value, str) else dumps(value)}\n\n".encode()


class Bus:
    def __init__(self, queue_size: int = 64, keepalive: float = 15.0):
        self.queue_size = queue_size
        self.keepalive = keepalive
        self.subscribers: set[asyncio.Queue] = set()
        self.listeners: list[Callable[[dict], None]] = []  # interne Mithörer (Tests, Statusverfolgung)

    def publish(self, event: dict) -> None:
        """Nur NACH dem Commit aufrufen: nie ein Ereignis für etwas, das nach einem Absturz nicht in der DB steht."""
        for listener in self.listeners:
            listener(event)
        for queue in list(self.subscribers):
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                self.subscribers.discard(queue)
                queue.get_nowait()
                queue.put_nowait(None)  # None = Verbindung beenden

    def stream(self, snapshot: Callable[[], dict]) -> StreamingResponse:
        queue: asyncio.Queue = asyncio.Queue(self.queue_size)
        self.subscribers.add(queue)
        first = {**snapshot(), "type": "snapshot"}

        async def body():
            try:
                yield sse(first)
                while True:
                    try:
                        event = await asyncio.wait_for(queue.get(), self.keepalive)
                    except asyncio.TimeoutError:
                        yield b": keepalive\n\n"
                        continue
                    if event is None:
                        return
                    yield sse(event)
            finally:
                self.subscribers.discard(queue)

        return StreamingResponse(body(), media_type="text/event-stream", headers=SSE_HEADERS)
