"""Local bridge so an AI agent can drive the mixer that lives in the browser tab.

Flow: agent -> POST /api/agent/command -> queued -> browser page long-polls GET /api/agent/poll,
runs the action, POSTs /api/agent/result -> the agent's request returns the result.
Events (track ending, transition started...) flow page -> POST /api/agent/event -> agent GET /api/agent/events.

Local only: loopback clients, localhost Host header and same-origin checks (like downloader.py).
The page must also have "Permitir control por agente" enabled, otherwise it stops polling.
"""
from __future__ import annotations

import asyncio
import time
import uuid
from collections import deque
from typing import Any
from urllib.parse import urlsplit

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field

from netguard import is_local_client, is_local_host_header

router = APIRouter(prefix="/api/agent")

POLL_SECONDS = 20
PAGE_ALIVE_SECONDS = 30
COMMAND_TIMEOUT_SECONDS = 300

_commands: asyncio.Queue[dict] = asyncio.Queue()
_waiting: dict[str, asyncio.Future] = {}
_events: deque[dict] = deque(maxlen=500)
_event_seq = 0
_event_signal = asyncio.Event()
_last_poll = 0.0


class CommandRequest(BaseModel):
    action: str = Field(min_length=1, max_length=40, pattern=r"^[a-z_]+$")
    args: dict[str, Any] = Field(default_factory=dict)
    timeout: float = Field(default=30, ge=1, le=COMMAND_TIMEOUT_SECONDS)


class ResultBody(BaseModel):
    id: str
    ok: bool
    result: Any = None
    error: str | None = None


class EventBody(BaseModel):
    type: str = Field(min_length=1, max_length=40)
    data: dict[str, Any] = Field(default_factory=dict)


def _guard(request: Request) -> None:
    client = request.client.host if request.client else ""
    if not is_local_client(client):
        raise HTTPException(status_code=403, detail="El control por agente solo está habilitado para uso local")
    if not is_local_host_header(request.headers.get("host")):
        raise HTTPException(status_code=403, detail="Host no permitido")
    origin = request.headers.get("origin")
    if origin and urlsplit(origin).netloc != request.headers.get("host"):
        raise HTTPException(status_code=403, detail="Origen no permitido")


def _page_alive() -> bool:
    return (time.monotonic() - _last_poll) < PAGE_ALIVE_SECONDS


@router.get("/status")
def status(request: Request):
    _guard(request)
    return {"page_connected": _page_alive(), "pending": _commands.qsize(), "last_event": _event_seq}


@router.post("/command")
async def command(body: CommandRequest, request: Request):
    _guard(request)
    if not _page_alive():
        raise HTTPException(
            status_code=503,
            detail="La app no está conectada: abrila en el navegador y activá «Permitir control por agente»",
        )
    cid = uuid.uuid4().hex
    fut: asyncio.Future = asyncio.get_running_loop().create_future()
    _waiting[cid] = fut
    await _commands.put({"id": cid, "action": body.action, "args": body.args})
    try:
        return await asyncio.wait_for(fut, timeout=body.timeout)
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="La app no respondió a tiempo (¿pestaña en segundo plano?)")
    finally:
        _waiting.pop(cid, None)


@router.get("/poll")
async def poll(request: Request, response: Response):
    """Browser side: wait for the next command (long-poll)."""
    global _last_poll
    _guard(request)
    _last_poll = time.monotonic()
    try:
        cmd = await asyncio.wait_for(_commands.get(), timeout=POLL_SECONDS)
    except asyncio.TimeoutError:
        _last_poll = time.monotonic()
        response.status_code = 204
        return None
    _last_poll = time.monotonic()
    return cmd


@router.post("/result")
async def result(body: ResultBody, request: Request):
    _guard(request)
    fut = _waiting.get(body.id)
    if fut and not fut.done():
        fut.set_result({"ok": body.ok, "result": body.result, "error": body.error})
    return {"ok": True}


@router.post("/event")
async def push_event(body: EventBody, request: Request):
    global _event_seq
    _guard(request)
    _event_seq += 1
    _events.append({"seq": _event_seq, "t": time.time(), "type": body.type, "data": body.data})
    _event_signal.set()
    return {"seq": _event_seq}


@router.get("/events")
async def events(request: Request, after: int = 0, wait: float = 0):
    """Agent side: events newer than `after`; with wait>0 blocks up to that many seconds for new ones."""
    _guard(request)
    wait = max(0.0, min(wait, 25.0))
    deadline = time.monotonic() + wait
    while True:
        fresh = [e for e in _events if e["seq"] > after]
        if fresh or time.monotonic() >= deadline:
            return {"events": fresh, "last": _event_seq}
        _event_signal.clear()
        try:
            await asyncio.wait_for(_event_signal.wait(), timeout=max(0.05, deadline - time.monotonic()))
        except asyncio.TimeoutError:
            pass
