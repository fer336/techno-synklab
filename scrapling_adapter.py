"""Optional Scrapling adapter for domains with documented extraction permission.

Not connected to the app by default. Does not target Beatport or bypass access controls.
Install: pip install -r requirements-scrapling.txt
"""
from urllib.parse import urlsplit


def fetch_allowed_title(url: str, approved_hosts: set[str]) -> dict:
    parsed = urlsplit(url)
    hostname = (parsed.hostname or "").lower()
    if parsed.scheme != "https" or hostname not in approved_hosts or parsed.username or parsed.password:
        raise ValueError("Dominio no autorizado. Verificá permisos y términos del sitio.")
    from scrapling.fetchers import Fetcher

    page = Fetcher.get(url)
    return {"url": url, "title": page.css("title::text").get(), "source": hostname}
