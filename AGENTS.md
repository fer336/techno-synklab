# AGENTS.md

Instructions for AI agents working in this repository. Humans can read it too.

## Before changing infrastructure
Read, in this order (INF-800): `INFRASTRUCTURE.md`, this file, `infra.project.yml` (**track `app`, profile `A`**), `.env.example`,
`docker-compose.yml` and `.github/workflows/`. Apply the rules of the declared track; do not assume another one (INF-801).

## Project facts
- SYNK//LAB is a browser-based Auto DJ. All audio processing happens in the user's browser (`static/mixer.js`, `static/mobile.js`).
- One service (`app`, FastAPI). No database, no migrations, no persistent volumes in production.
- Configuration is the single secret `techno_synklab_env` mounted at `/run/secrets/techno_synklab_env` (loaded by `config.py`).
  Precedence: process env > secret > `.env` > code defaults. There are **no** build-time/frontend variables.
- Production is **release-driven**. Never deploy on a push to `main`. Never use `latest`.

## Local-only features must stay local
`/api/agent/*` and the download endpoints are guarded by `netguard.py` (loopback only; the Docker bridge is accepted only when
`SYNKLAB_IN_CONTAINER=1`). The production stack sets `SYNKLAB_IN_CONTAINER=0`, so they are disabled there. Do not weaken those checks.

## Rules that are easy to break
- A new runtime variable goes in `config.py` handling, in `.env.example` (runtime section) and in the secret. **Never create a new secret.**
- Do not put secrets in the compose, the code, the workflows or any `build-arg` (INF-600, INF-604).
- Pipeline changes keep the order of INFRASTRUCTURE.md 7.2 and must not be able to report a false success.
- Run `python3 -m unittest discover -s tests` before proposing a change. Add a test for each new rule.

## Commits and attribution
- Conventional Commits, in English.
- The repository owner's standing instruction is **no `Co-authored-by` or AI attribution in commits**. INF-822 asks for the opposite,
  so this is recorded as a proposed deviation in `docs/DEVIATIONS.md` (INF-901: an agent proposes, the owner approves).
  Until it is approved, follow the owner's instruction.
- Commits made by the pipeline are authored by `github-actions[bot]` (INF-821). Never invent bot identities (INF-823).

## What an agent must not do (INF-810)
Use floating tags, create one secret per variable, put frontend variables in the secret, version real `.env` files, trigger a deploy
before the compose is pushed, report success with a failed verification, delete persistent volumes, or redesign the infrastructure
unprompted. Local `.env*` files are off limits to agents.
