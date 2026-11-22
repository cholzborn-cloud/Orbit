"""Ein Worker je Orbi. Ein gemeinsames Semaphore begrenzt die Läufe im ganzen Dienst (MAX_PARALLEL_RUNS).

Der Schlitz wird VOR dem Auswählen genommen: wer keinen Schlitz hat, wählt nichts aus und blockiert keinen Eintrag.
"""
import asyncio
import logging

log = logging.getLogger("orbitd")


class Actor:
    def __init__(self, rt, bot_id: str):
        self.rt, self.bot_id = rt, bot_id
        self.event = asyncio.Event()
        self.task = asyncio.create_task(self._loop())

    def wake(self) -> None:
        self.event.set()

    async def _loop(self) -> None:
        while True:
            await self.event.wait()
            self.event.clear()
            while not self.rt.closing:
                async with self.rt.slots:
                    try:
                        ran = await self.rt.run_next(self.bot_id)
                    except asyncio.CancelledError:
                        raise
                    except Exception:
                        log.exception("Worker %s: Lauf gescheitert", self.bot_id)
                        ran = False
                if not ran:
                    break

    async def stop(self) -> None:
        self.task.cancel()
        await asyncio.gather(self.task, return_exceptions=True)
