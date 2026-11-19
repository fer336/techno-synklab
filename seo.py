"""SYNK//LAB SEO: one crawlable URL per service, sitemap, robots and structured data.

Every page is the same single-page app (static/index.html). The server only changes what a crawler or a first paint
needs: <title>, description, canonical, Open Graph, JSON-LD, the active view and which heading is the page's <h1>.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from html import escape
from pathlib import Path

DEFAULT_SITE = "https://synklab.qeva-ai.com"
OG_IMAGE = "/static/og-image.png"
GITHUB = "https://github.com/fer336/techno-synklab"


def site_url() -> str:
    """Public origin used in canonicals and the sitemap. A constant on purpose: canonicals should always point at production,
    and a new runtime variable would have to be added to the secret (AGENTS.md)."""
    return DEFAULT_SITE


@dataclass(frozen=True)
class Page:
    path: str
    view: str
    title: str
    description: str
    name: str
    features: tuple[str, ...]


PAGES = (
    Page("/", "autodj",
         "SYNK//LAB · Auto DJ online para techno, gratis en tu navegador",
         "Mezclador Auto DJ online: dos decks, mezcla por frases, EQ y efectos con tus propios archivos. "
         "Todo se procesa en tu navegador, sin subir nada.",
         "Auto DJ online para techno",
         ("Dos decks con crossfader", "Transiciones automáticas por frases", "EQ de 3 bandas, filtros y efectos",
          "Sincronización de tempo y de golpes", "Procesamiento local en el navegador")),
    Page("/detector-bpm-tonalidad", "analyze",
         "Detector de BPM y tonalidad Camelot online · SYNK//LAB",
         "Analiza el BPM, la tonalidad (Camelot) y la rejilla de golpes de tus temas en el navegador, sin subir "
         "archivos. Pensado para DJs de techno.",
         "Detector de BPM y tonalidad",
         ("BPM estimado y rejilla de golpes", "Tonalidad en notación Camelot", "Análisis local sin subir archivos")),
    Page("/planificador-sets-techno", "sets",
         "Planificador de sets de techno por BPM y Camelot · SYNK//LAB",
         "Ordena tu set de techno por BPM, mezcla armónica (rueda de Camelot) y curva de energía, y revisa cada "
         "transición antes de mezclar.",
         "Planificador de sets de techno",
         ("Orden por BPM y tonalidad", "Curva de energía del set", "Revisión de transiciones")),
    Page("/sellos-techno", "labels",
         "Explorador de sellos de techno y sus lanzamientos · SYNK//LAB",
         "Descubre sellos de techno y sus lanzamientos con datos abiertos de MusicBrainz y lleva el siguiente tema "
         "a tu set.",
         "Explorador de sellos de techno",
         ("Búsqueda de sellos", "Lanzamientos por sello", "Datos abiertos de MusicBrainz")),
    Page("/descubrir-musica-techno", "discover",
         "Descubrir música techno: catálogo y referencias · SYNK//LAB",
         "Busca artistas, lanzamientos y sellos de techno en MusicBrainz y agrega temas a tu próximo set.",
         "Descubrir música techno",
         ("Búsqueda de catálogo", "Referencias por tema", "Agregar al set")),
)
BY_PATH = {p.path: p for p in PAGES}
ROUTES = {p.view: p.path for p in PAGES}
CONTENT_DIR = Path(__file__).resolve().parent / "content"
_content_cache: dict = {}
SECTION_OPEN = '<section class="view{active}" id="view-{view}">'


def _jsonld(page: Page, base: str) -> dict:
    url = base + page.path
    org = {"@type": "Organization", "@id": base + "/#org", "name": "SYNK//LAB",
           "alternateName": ["SynkLab", "SYNK//LAB DJ"], "url": base + "/", "sameAs": [GITHUB]}
    site = {"@type": "WebSite", "@id": base + "/#site", "name": "SYNK//LAB", "url": base + "/",
            "inLanguage": "es", "publisher": {"@id": base + "/#org"}}
    app = {"@type": "WebApplication", "@id": url + "#app", "name": "SYNK//LAB · " + page.name, "url": url,
           "description": page.description, "applicationCategory": "MultimediaApplication",
           "operatingSystem": "Any (web browser)", "browserRequirements": "Requires JavaScript and the Web Audio API",
           "inLanguage": "es", "featureList": list(page.features),
           "offers": {"@type": "Offer", "price": "0", "priceCurrency": "USD"}, "publisher": {"@id": base + "/#org"}}
    graph = [org, site, app]
    if page.path != "/":
        graph.append({"@type": "BreadcrumbList", "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "SYNK//LAB", "item": base + "/"},
            {"@type": "ListItem", "position": 2, "name": page.name, "item": url}]})
    return {"@context": "https://schema.org", "@graph": graph}


def _head(page: Page, base: str) -> str:
    url, img = base + page.path, base + OG_IMAGE
    d, t = escape(page.description, quote=True), escape(page.title, quote=True)
    ld = json.dumps(_jsonld(page, base), ensure_ascii=False).replace("</", "<\\/")
    routes = json.dumps(ROUTES).replace("</", "<\\/")
    return "\n".join([
        f'<meta name="description" content="{d}"/>',
        '<meta name="robots" content="index,follow,max-image-preview:large"/>',
        f'<link rel="canonical" href="{url}"/>',
        '<link rel="icon" type="image/svg+xml" href="/static/favicon.svg"/>',
        '<meta property="og:type" content="website"/>', '<meta property="og:site_name" content="SYNK//LAB"/>',
        f'<meta property="og:title" content="{t}"/>', f'<meta property="og:description" content="{d}"/>',
        f'<meta property="og:url" content="{url}"/>', f'<meta property="og:image" content="{img}"/>',
        '<meta property="og:image:width" content="1200"/>', '<meta property="og:image:height" content="630"/>',
        '<meta name="twitter:card" content="summary_large_image"/>',
        f'<meta name="twitter:title" content="{t}"/>', f'<meta name="twitter:description" content="{d}"/>',
        f'<meta name="twitter:image" content="{img}"/>',
        f'<script type="application/ld+json">{ld}</script>',
        f'<script>window.__SEO_VIEW__="{page.view}";window.__SEO_ROUTES__={routes};</script>',
    ])


def _swap_heading(html: str, view: str, to_h1: bool) -> str:
    """Make the heading of one view the page's <h1>, or demote it to <h2> (same styling: both carry class "h1")."""
    start = html.find(SECTION_OPEN.format(active="", view=view))
    if start < 0:
        start = html.find(SECTION_OPEN.format(active=" active", view=view))
    if start < 0:
        return html
    src, dst = ("h2", "h1") if to_h1 else ("h1", "h2")
    o = html.find(f'<{src} class="h1">', start)
    if o < 0:
        return html
    c = html.find(f"</{src}>", o)
    return html[:o] + f'<{dst} class="h1">' + html[o + len(f'<{src} class="h1">'):c] + f"</{dst}>" + html[c + len(f"</{src}>"):]


def content(view: str) -> str | None:
    """The long-form article for a view (content/<view>.html), re-read only when the file changes."""
    f = CONTENT_DIR / f"{view}.html"
    if view not in ROUTES or not f.is_file():
        return None
    mtime = f.stat().st_mtime
    cached = _content_cache.get(view)
    if not cached or cached[0] != mtime:
        _content_cache[view] = cached = (mtime, f.read_text(encoding="utf-8"))
    return cached[1]


def render(page: Page, html: str, base: str | None = None) -> str:
    base = base or site_url()
    html = re.sub(r"<title>.*?</title>", lambda _: f"<title>{escape(page.title)}</title>", html, count=1, flags=re.S)
    html = re.sub(r'<meta name="description"[^>]*>', lambda _: _head(page, base), html, count=1)
    if page.view != "autodj":
        html = html.replace(SECTION_OPEN.format(active=" active", view="autodj"), SECTION_OPEN.format(active="", view="autodj"), 1)
        html = html.replace(SECTION_OPEN.format(active="", view=page.view), SECTION_OPEN.format(active=" active", view=page.view), 1)
        html = _swap_heading(html, "autodj", to_h1=False)
        html = _swap_heading(html, page.view, to_h1=True)
    body = content(page.view)
    slot = f'<div class="seo-content" id="seo-content-{page.view}"></div>'
    if body and slot in html:
        html = html.replace(slot, f'<div class="seo-content" id="seo-content-{page.view}">{body}</div>', 1)
    return html


def sitemap(lastmod: datetime, base: str | None = None) -> str:
    base = base or site_url()
    day = lastmod.astimezone(timezone.utc).strftime("%Y-%m-%d")
    rows = "".join(
        f"<url><loc>{base}{p.path}</loc><lastmod>{day}</lastmod>"
        f"<changefreq>{'weekly' if p.path == '/' else 'monthly'}</changefreq>"
        f"<priority>{'1.0' if p.path == '/' else '0.8'}</priority></url>" for p in PAGES)
    return f'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{rows}</urlset>\n'


def robots(base: str | None = None) -> str:
    base = base or site_url()
    return f"User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /contenido/\nDisallow: /health\nDisallow: /version\n\nSitemap: {base}/sitemap.xml\n"


NOT_FOUND_HTML = """<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta name="robots" content="noindex"/><title>Página no encontrada · SYNK//LAB</title>
<style>body{margin:0;background:#080b0b;color:#edf1e9;font:16px/1.5 system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;padding:24px}
main{max-width:520px}h1{font-size:28px;margin:0 0 8px}a{color:#caff1a}</style></head><body><main>
<h1>No encontramos esa página</h1><p>Prueba con alguna de las herramientas de SYNK//LAB:</p><ul>{links}</ul></main></body></html>"""


def not_found_html() -> str:
    links = "".join(f'<li><a href="{p.path}">{escape(p.name)}</a></li>' for p in PAGES)
    return NOT_FOUND_HTML.replace("{links}", links)
