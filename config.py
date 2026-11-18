"""Runtime configuration loader (INFRASTRUCTURE.md section 6).

Precedence, identical in every environment:
  1. process environment variables      (highest)
  2. /run/secrets/<PROJECT>_env          (production: the single Docker secret)
  3. .env                                (development only)
  4. defaults in the code                (lowest)

Only one of the two files is read: the secret when it exists, otherwise ``.env``. Existing process variables are
never overridden. The parser is dependency-free (KEY=VALUE lines).
"""
from __future__ import annotations

import os
from pathlib import Path

DEFAULT_PROJECT = "techno_synklab"
PLACEHOLDER_MARKERS = ("example.org", "example.com", "your-contact", "tu-contacto")


def project() -> str:
    return os.environ.get("PROJECT_NAME", DEFAULT_PROJECT)


def secret_path() -> Path:
    return Path("/run/secrets") / f"{project()}_env"


def parse(text: str) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        if key:
            values[key] = value
    return values


def load(env_file: Path | None = None) -> Path | None:
    """Merge the secret (or .env) into os.environ without overriding anything already set. Returns the file used."""
    path = secret_path()
    if not path.is_file():
        path = env_file or Path(".env")
    if not path.is_file():
        return None
    for key, value in parse(path.read_text(encoding="utf-8-sig")).items():  # utf-8-sig: tolerate a BOM
        os.environ.setdefault(key, value)
    return path


def is_production() -> bool:
    return os.environ.get("APP_ENV", "").lower() == "production"


def validate() -> None:
    """Fail fast and explicitly when a required variable is missing (production only). Never prints values."""
    if not is_production():
        return
    ua = os.environ.get("MUSICBRAINZ_USER_AGENT", "").strip()
    problems = []
    if not ua:
        problems.append("MUSICBRAINZ_USER_AGENT is missing")
    elif any(marker in ua.lower() for marker in PLACEHOLDER_MARKERS):
        problems.append("MUSICBRAINZ_USER_AGENT still holds a placeholder contact")
    if problems:
        raise SystemExit("Invalid configuration: " + "; ".join(problems) +
                         f". Provide it in the secret {secret_path()} (see .env.example).")


def version() -> str:
    return os.environ.get("APP_VERSION", "dev")
