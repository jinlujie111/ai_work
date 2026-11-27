from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable

ProgressCb = Callable[[dict], Awaitable[None] | None]


async def _emit(on_event: ProgressCb | None, payload: dict) -> None:
    if not on_event:
        return
    maybe = on_event(payload)
    if asyncio.iscoroutine(maybe):
        await maybe
