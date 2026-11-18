# Deployment (Portainer)

Project-specific details required by INF-701. The rules live in [`INFRASTRUCTURE.md`](../INFRASTRUCTURE.md);
this page is the runbook for **https://synklab.qeva-ai.com**.

## What gets deployed
One stateless service, `app`, from `ghcr.io/fer336/techno-synklab:<tag>`. In hosted mode SYNK//LAB is a web app that mixes the
visitor's own files in their browser. The AI agent and the downloads are local-only by design and stay **disabled** (the stack sets
`SYNKLAB_IN_CONTAINER=0`); the MusicBrainz catalog and the static UI work normally.

| Topic | Decision |
|---|---|
| Track / profile | `app` / `A` (single replica; Swarm-mode Portainer endpoint, because the standard requires an external secret) |
| Migrations (INF-320) | None: the app has no database schema |
| Volumes (INF-513) | None in production. The `inbox` volume exists only in the local installer and in `docker-compose.dev.yml` |
| Backups | Not applicable: no persistent data |
| Health | `GET /health` → `{"status":"ok"}` · `GET /version` → `{"version":"vX.Y.Z"}` |

## One-time setup in Portainer (done by a person, INF-301)

### 1. The single runtime secret: `techno_synklab_env`
*Secrets → Add secret*, name **`techno_synklab_env`**, content (real values, never committed):

```text
MUSICBRAINZ_USER_AGENT=SynkLab/0.3 (<a real contact: email or URL>)
```

MusicBrainz requires a real contact in the User-Agent; in production the app refuses to start with a missing or placeholder value.
One secret for the whole project: do not create one per variable. To rotate it, replace the secret and restart the service (INF-241).

### 2. The overlay network `proxy`
The stack joins an **external** overlay network named `proxy`, shared with the reverse proxy. Create it once if it does not exist.

### 3. The stack
*Stacks → Add stack → Repository*: this repository, branch `main`, compose path `docker-compose.yml`.
Enable the **webhook** for the stack and copy its URL.

> **Assumed reverse proxy: Traefik.** `docker-compose.yml` carries Traefik labels (`websecure`, `letsencrypt`). If you use another
> proxy, or other entrypoint / resolver names, change those labels once; the pipeline only touches the image tag.

## One-time setup in GitHub
- *Settings → Environments → New environment* **`production`**.
- In that environment add the secret **`PORTAINER_WEBHOOK_URL`** (the stack webhook from step 3). It is the only CI secret (INF-240);
  publishing to GHCR uses the built-in `GITHUB_TOKEN`.
- *Settings → Actions → General → Workflow permissions*: read and write (the pipeline pins the tag in `docker-compose.yml`).

## Before the first release
- `docker-compose.yml` already pins `v0.3.0`, but that image does not exist until the first release is published. Do not deploy the stack
  from `main` before then.
- If the GHCR package is **private**, add the registry (`ghcr.io`, a token with `read:packages`) under *Registries* in Portainer and
  enable *with registry authentication* on the stack. Making the package public avoids this.
- If `main` is branch-protected, the bot cannot push the pinned tag: allow `github-actions[bot]` to bypass, or pin the tag by hand.
  Releases must be cut from `main`; the workflow refuses a tag that is not reachable from it.

## Releasing
Create a GitHub release with a tag `vMAJOR.MINOR.PATCH` (for example `v0.3.0`). The workflow `.github/workflows/release.yml` then:
validates the tag → runs the tests → builds and publishes `ghcr.io/fer336/techno-synklab:<tag>` (never overwriting an existing tag) →
pins the tag in `docker-compose.yml` and pushes it as `github-actions[bot]` → calls the Portainer webhook → polls
`https://synklab.qeva-ai.com/health` and `/version` for up to 5 minutes and fails unless production reports the new version.

A push to `main` never deploys (INF-300).

## Rollback (INF-120/121)
No pipeline needed: in `docker-compose.yml` (or directly in the stack editor, then mirror it back to the repo) set `image:` to a
previously valid tag, for example `v0.3.0`, and update the stack. Never rebuild an old image. The app has no schema, so an image
rollback is complete.

## Configuration contract
Runtime variables (the secret) and public build-time variables are two different families. SYNK//LAB has **no** build-time variables.

`.env.example` (create it at the repository root; it needs the owner's permission because agents cannot write `.env*` files here):

```text
# ============================================================
# RUNTIME / BACKEND  ->  Van en el secret "techno_synklab_env" (Portainer)
# Precedencia: entorno del proceso > /run/secrets/techno_synklab_env > .env > valores por defecto
# ============================================================
MUSICBRAINZ_USER_AGENT=
SYNKLAB_INBOX=
SYNKLAB_ALLOW_REMOTE_DOWNLOAD=
SYNKLAB_YTDLP_COOKIES_BROWSER=

# ============================================================
# BUILD-TIME / FRONTEND  ->  NO van en Portainer
# La interfaz es HTML estatico: no hay variables VITE_*, NEXT_PUBLIC_* ni equivalentes.
# ============================================================

# Fijadas por la imagen o por el stack (no van en el secret):
# APP_ENV=production · APP_VERSION=<tag de la release> · PROJECT_NAME=techno_synklab · SYNKLAB_IN_CONTAINER=0
```

## Local development
`docker compose -f docker-compose.dev.yml up -d`, the one-line installer (`install.sh`), or `uvicorn server:app --reload`.
Locally the configuration comes from the environment or an untracked `.env`.
