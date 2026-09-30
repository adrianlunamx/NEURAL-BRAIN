"""In-process event bus feeding the SSE endpoint.

Fan-out: every SSE client gets its own asyncio.Queue, so two open browser tabs
both receive every event (a single shared queue would split events between them).
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any, AsyncIterator, Dict, Set


class EventBus:
    def __init__(self, maxsize: int = 1000) -> None:
        self.maxsize = maxsize
        self._subscribers: Set[asyncio.Queue] = set()

    @property
    def subscriber_count(self) -> int:
        return len(self._subscribers)

    async def publish(self, event_type: str, payload: Dict[str, Any]) -> None:
        event = {
            "type": event_type,
            "data": payload,
            "ts": datetime.now(timezone.utc).isoformat(),
        }
        for queue in list(self._subscribers):
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                # Drop the oldest event to make room; liveness beats completeness.
                try:
                    queue.get_nowait()
                except asyncio.QueueEmpty:
                    pass
                queue.put_nowait(event)

    async def stream(self) -> AsyncIterator[Dict[str, Any]]:
        queue: asyncio.Queue = asyncio.Queue(maxsize=self.maxsize)
        self._subscribers.add(queue)
        try:
            while True:
                yield await queue.get()
        finally:
            self._subscribers.discard(queue)
