"""SYNK//LAB — public metadata APIs. No Beatport scraping or audio downloads."""
from __future__ import annotations

import asyncio
import os
import re
import time
from urllib.parse import urlsplit

import config

config.load()      # secret (production) or .env (development); never overrides the process environment
config.validate()  # fail fast in production if a required variable is missing

import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pathlib import Path

from downloader import router as download_router
from agent_bridge import router as agent_router

app = FastAPI(title="SYNK//LAB", version=config.version())
app.include_router(download_router)
app.include_router(agent_router)
ROOT = Path(__file__).resolve().parent


@app.get("/health")
def health():
    """Liveness (INFRASTRUCTURE.md INF-500)."""
    return {"status": "ok"}


@app.get("/version")
def version():
    """The release that is actually running (INF-502): injected at build time as APP_VERSION."""
    return {"version": config.version()}

MB = "https://musicbrainz.org/ws/2"
UA = os.environ.get("MUSICBRAINZ_USER_AGENT", "SynkLabPrototype/0.1 (https://example.org/synklab; contact: developer@example.org)")
rate_lock = asyncio.Lock()
last_called = 0.0
cache = {}
CACHE_SECONDS = 21600

async def mb_get(entity: str, params: dict):
    """Respect MusicBrainz 1 request/second limit, including across API endpoints."""
    global last_called
    key = (entity, tuple(sorted(params.items())))
    saved = cache.get(key)
    if saved and time.monotonic() - saved[0] < CACHE_SECONDS:
        return saved[1]
    async with rate_lock:
        saved = cache.get(key)
        if saved and time.monotonic() - saved[0] < CACHE_SECONDS:
            return saved[1]
        wait = max(0, 1.1 - (time.monotonic() - last_called))
        if wait:
            await asyncio.sleep(wait)
        last_called = time.monotonic()
        try:
            async with httpx.AsyncClient(timeout=18.0, follow_redirects=False, headers={"User-Agent": UA}) as client:
                response = await client.get(f"{MB}/{entity}", params={**params, "fmt": "json"})
                response.raise_for_status()
                result = response.json()
        except httpx.HTTPStatusError as exc:
            raise HTTPException(status_code=502, detail=f"MusicBrainz respondió {exc.response.status_code}")
        except (httpx.HTTPError, ValueError):
            raise HTTPException(status_code=502, detail="MusicBrainz no está disponible en este momento")
        cache[key] = (time.monotonic(), result)
        return result

def tidy(value: str) -> str:
    value = re.sub(r"[\\\"():]+", " ", value)
    return " ".join(value.split())[:140]

@app.get("/api/health")
def health():
    return {"ok": True, "catalog": "musicbrainz", "beatport": "external_link_only", "scrapling": "optional_disabled"}

@app.get("/api/search")
async def search(q: str = Query(min_length=2, max_length=140)):
    raw = await mb_get("recording", {"query": tidy(q), "limit": "24"})
    items = []
    for r in raw.get("recordings", []):
        ac = r.get("artist-credit") or []
        artists = "".join(p.get("name", "") + (p.get("joinphrase") or "") for p in ac if isinstance(p, dict)).strip() or "Artista sin datos"
        releases = r.get("releases") or []
        rel = releases[0] if releases else {}
        items.append({
            "id": r.get("id"), "title": r.get("title"), "artist": artists,
            "release": rel.get("title"), "release_id": rel.get("id"),
            "date": rel.get("date"), "duration": r.get("length"),
            "score": r.get("score"), "source": "MusicBrainz",
        })
    return {"results": items, "count": raw.get("count", 0), "type": "catalog_metadata", "note": "Coincidencias de texto, NO similitud acústica."}

@app.get("/api/labels")
async def labels(q: str = Query(min_length=2, max_length=140)):
    raw = await mb_get("label", {"query": tidy(q), "limit": "20"})
    return {"results": [{"id": x.get("id"), "name": x.get("name"), "country": x.get("country"), "type": x.get("type"), "score": x.get("score"), "source": "MusicBrainz"} for x in raw.get("labels", [])], "count": raw.get("count", 0)}

@app.get("/api/releases")
async def releases(label: str = Query(min_length=2, max_length=140)):
    # MusicBrainz release search supports label indexed field.
    safe = tidy(label)
    raw = await mb_get("release", {"query": f'label:"{safe}"', "limit": "20"})
    return {"results": [{"id": r.get("id"), "title": r.get("title"), "date": r.get("date"), "artist": r.get("artist-credit", [{}])[0].get("name", "") if r.get("artist-credit") else "", "status": r.get("status"), "source": "MusicBrainz"} for r in raw.get("releases", [])], "count": raw.get("count", 0)}

@app.get("/api/release/{release_id}")
async def release(release_id: str):
    if not re.fullmatch(r"[0-9a-fA-F-]{36}", release_id):
        raise HTTPException(status_code=400, detail="Identificador inválido")
    raw = await mb_get(f"release/{release_id}", {"inc": "labels+release-groups"})
    label_info = raw.get("label-info", [])
    return {"title": raw.get("title"), "date": raw.get("date"), "labels": [{"name": l.get("label", {}).get("name"), "catalog_number": l.get("catalog-number")} for l in label_info if l.get("label")], "primary_type": (raw.get("release-group") or {}).get("primary-type"), "secondary_types": (raw.get("release-group") or {}).get("secondary-types", [])}

@app.get("/api/youtube")
async def youtube(url: str = Query(min_length=15, max_length=1500)):
    p = urlsplit(url)
    host = (p.hostname or "").lower()
    allowed = {"www.youtube.com", "youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"}
    if p.scheme != "https" or host not in allowed or p.username or p.password:
        raise HTTPException(status_code=400, detail="Ingresá un enlace HTTPS válido de YouTube")
    try:
        async with httpx.AsyncClient(timeout=12.0, follow_redirects=False) as client:
            resp = await client.get("https://www.youtube.com/oembed", params={"url": url, "format": "json"})
            resp.raise_for_status()
            data = resp.json()
    except (httpx.HTTPError, ValueError):
        raise HTTPException(status_code=502, detail="No fue posible obtener el título del video (oEmbed)")
    return {"title": data.get("title"), "author": data.get("author_name"), "thumbnail": data.get("thumbnail_url"), "source": "YouTube oEmbed", "method": "metadata_only", "note": "Se obtuvo el título público; no se analizó ni descargó el audio."}

class RevalidatedStatic(StaticFiles):
    """Static files that the browser must revalidate (ETag) so a code update is never served from a stale cache."""

    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        response.headers["Cache-Control"] = "no-cache"
        return response


app.mount("/static", RevalidatedStatic(directory=ROOT / "static"), name="static")

@app.get("/")
def home():
    return FileResponse(ROOT / "static" / "index.html", headers={"Cache-Control": "no-cache"})
