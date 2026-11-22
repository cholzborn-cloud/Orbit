"""Antwort-Strom je Chat (AI-SDK-UI-Format). Gepuffert: hängt nicht an der HTTP-Verbindung, `/stream` spielt ab Anfang ab."""
import asyncio

from starlette.responses import Response, StreamingResponse

from ..events import SSE_HEADERS, sse

HEADERS = {**SSE_HEADERS, "x-vercel-ai-ui-message-stream": "v1"}


class TurnStream:
    def __init__(self):
        self.chunks: list[dict] = []
        self.closed = False
        self._changed = asyncio.Event()

    def emit(self, chunk: dict) -> None:
        if not self.closed:
            self.chunks.append(chunk)
            self._changed.set()

    def close(self) -> None:
        self.closed = True
        self._changed.set()

    async def body(self):
        sent = 0
        while True:
            while sent < len(self.chunks):
                yield sse(self.chunks[sent])
                sent += 1
            if self.closed:
                yield sse("[DONE]")
                return
            self._changed.clear()
            if sent == len(self.chunks) and not self.closed:
                await self._changed.wait()

    def response(self) -> StreamingResponse:
        return StreamingResponse(self.body(), media_type="text/event-stream", headers=HEADERS)


def empty_response() -> Response:
    """Leerer, sofort beendeter Strom: die Nachricht ist angenommen und steht im Verlauf (Chat war belegt)."""
    stream = TurnStream()
    stream.close()
    return stream.response()


class Streams:
    def __init__(self):
        self._by_chat: dict[str, TurnStream] = {}

    def open(self, chat_id: str) -> TurnStream:
        """Neuer Strom für den nächsten Lauf dieses Chats (ein offener wird weiterbenutzt)."""
        current = self._by_chat.get(chat_id)
        if current and not current.closed:
            return current
        self._by_chat[chat_id] = stream = TurnStream()
        return stream

    def active(self, chat_id: str) -> TurnStream | None:
        stream = self._by_chat.get(chat_id)
        return stream if stream and not stream.closed else None

    def forget(self, chat_id: str) -> None:
        self._by_chat.pop(chat_id, None)
