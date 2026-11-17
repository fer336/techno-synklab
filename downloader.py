"""Optional local audio download via yt-dlp (opt-in per link, loopback clients only).

Only meant for content the user has the right to download (own uploads, downloads enabled by the
artist, free licenses). Nothing is downloaded unless the UI explicitly requests it.
"""
from __future__ import annotations

import asyncio
import os
import shutil
import uuid
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from netguard import is_local_client, is_local_host_header, is_loopback_client

router = APIRouter(prefix="/api/download")

INBOX = Path(os.environ.get("SYNKLAB_INBOX", Path.home() / "Música" / "Inbox")).expanduser()
# Optional, off by default: e.g. SYNKLAB_YTDLP_COOKIES_BROWSER=chrome (reads that browser's cookies).
COOKIES_BROWSER = os.environ.get("SYNKLAB_YTDLP_COOKIES_BROWSER", "").strip()
ALLOW_REMOTE = os.environ.get("SYNKLAB_ALLOW_REMOTE_DOWNLOAD") == "1"
ALLOWED_HOSTS = {
    "youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be",
    "soundcloud.com", "www.soundcloud.com", "m.soundcloud.com", "on.soundcloud.com",
}
TIMEOUT_SECONDS = 600
MAX_JOBS = 50

jobs: dict[str, dict] = {}
slots = asyncio.Semaphore(2)


class DownloadRequest(BaseModel):
    url: str = Field(min_length=15, max_length=1500)


def _guard(request: Request) -> None:
    """Local-only: block remote clients and cross-site browser requests (DNS rebinding / CSRF)."""
    client = request.client.host if request.client else ""
    if not ALLOW_REMOTE and not is_local_client(client):
        raise HTTPException(status_code=403, detail="La descarga solo está habilitada para uso local")
    if not ALLOW_REMOTE and not is_loopback_client(client) and not is_local_host_header(request.headers.get("host")):
        raise HTTPException(status_code=403, detail="Host no permitido")  # container bridge: keep the DNS-rebinding guard
    origin = request.headers.get("origin")
    if origin and urlsplit(origin).netloc != request.headers.get("host"):
        raise HTTPException(status_code=403, detail="Origen no permitido")


def _binary() -> str | None:
    return shutil.which("yt-dlp")


def _validate_url(url: str) -> str:
    p = urlsplit(url.strip())
    host = (p.hostname or "").lower()
    if p.scheme != "https" or host not in ALLOWED_HOSTS or p.username or p.password:
        raise HTTPException(status_code=400, detail="Solo se aceptan enlaces HTTPS de YouTube o SoundCloud")
    return p.geturl()


def _command(binary: str, url: str) -> list[str]:
    cmd = [
        binary, "--no-playlist", "-x", "--audio-format", "mp3", "--audio-quality", "320K",
        "--embed-metadata", "--embed-thumbnail", "--write-info-json", "--no-overwrites", "--no-progress",
        "--parse-metadata", "%(artist|)s:%(meta_artist)s",
        "-P", str(INBOX), "-o", "%(artist&{} - |)s%(track,title)s.%(ext)s",
        "--print", "after_move:filepath",
    ]
    if COOKIES_BROWSER:
        cmd += ["--cookies-from-browser", COOKIES_BROWSER]
    return cmd + ["--", url]


async def _run(job_id: str, url: str, binary: str) -> None:
    job = jobs[job_id]
    async with slots:
        job["status"] = "running"
        try:
            INBOX.mkdir(parents=True, exist_ok=True)
            proc = await asyncio.create_subprocess_exec(
                *_command(binary, url),
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
            )
            try:
                out, err = await asyncio.wait_for(proc.communicate(), timeout=TIMEOUT_SECONDS)
            except asyncio.TimeoutError:
                proc.kill()
                await proc.wait()
                raise RuntimeError("La descarga superó el tiempo máximo (10 min)")
            lines = [l.strip() for l in out.decode("utf-8", "replace").splitlines() if l.strip()]
            path = next((Path(l) for l in reversed(lines) if l.startswith("/") and l.lower().endswith(".mp3")), None)
            if proc.returncode != 0 or not path or not path.is_file():
                detail = [l for l in err.decode("utf-8", "replace").splitlines() if l.startswith("ERROR")]
                raise RuntimeError((detail[-1] if detail else "yt-dlp no pudo descargar este enlace")[:300])
            job.update(status="done", path=path, name=path.name)
        except Exception as exc:  # noqa: BLE001 - surfaced to the UI as a message
            job.update(status="error", error=str(exc) or "Error desconocido")


@router.get("/status")
def status(request: Request):
    _guard(request)
    binary = _binary()
    return {"enabled": bool(binary), "inbox": str(INBOX), "cookies_browser": COOKIES_BROWSER or None}


@router.post("")
async def start(body: DownloadRequest, request: Request):
    _guard(request)
    binary = _binary()
    if not binary:
        raise HTTPException(status_code=503, detail="yt-dlp no está instalado en este equipo")
    url = _validate_url(body.url)
    if len(jobs) >= MAX_JOBS:
        for old in [k for k, v in jobs.items() if v["status"] in ("done", "error")][: MAX_JOBS // 2]:
            jobs.pop(old, None)
    job_id = uuid.uuid4().hex
    jobs[job_id] = {"status": "queued", "url": url}
    asyncio.create_task(_run(job_id, url, binary))
    return {"id": job_id}


@router.get("/{job_id}")
def job_status(job_id: str, request: Request):
    _guard(request)
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Descarga inexistente")
    return {"status": job["status"], "name": job.get("name"), "error": job.get("error")}


@router.get("/{job_id}/file")
def job_file(job_id: str, request: Request):
    _guard(request)
    job = jobs.get(job_id)
    if not job or job["status"] != "done":
        raise HTTPException(status_code=404, detail="Archivo no disponible")
    path: Path = job["path"]
    if not path.is_file() or INBOX.resolve() not in path.resolve().parents:
        raise HTTPException(status_code=404, detail="Archivo no disponible")
    return FileResponse(path, media_type="audio/mpeg", filename=path.name)
