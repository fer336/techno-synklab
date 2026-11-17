#!/bin/sh
# SYNK//LAB installer. Builds the Docker image with every dependency (ffmpeg, yt-dlp) and starts it.
#
#   curl -fsSL https://raw.githubusercontent.com/fer336/techno-synklab/main/install.sh | sh
#   curl -fsSL https://raw.githubusercontent.com/fer336/techno-synklab/main/install.sh | sh -s -- uninstall
#
# Requires: docker, curl, tar. Optional (for the AI DJ agent): python3 and the `claude` or `codex` CLI.
#
# Environment:
#   SYNKLAB_REPO   GitHub "owner/name" to download            (default: fer336/techno-synklab)
#   SYNKLAB_REF    branch or tag to download                   (default: main)
#   SYNKLAB_SRC    local source directory instead of GitHub    (for development)
#   SYNKLAB_PORT   port on 127.0.0.1                           (default: 8000)
#   SYNKLAB_INBOX  folder for downloaded audio                 (default: ~/SynkLab/Inbox)
#   SYNKLAB_NAME   container name                              (default: synklab)
#   SYNKLAB_BIN    where the `synklab-agent` command goes      (default: ~/.local/bin)
#   MUSICBRAINZ_USER_AGENT  your contact string for MusicBrainz (recommended)
set -eu

REPO="${SYNKLAB_REPO:-fer336/techno-synklab}"
REF="${SYNKLAB_REF:-main}"
SRC="${SYNKLAB_SRC:-}"
NAME="${SYNKLAB_NAME:-synklab}"
PORT="${SYNKLAB_PORT:-8000}"
IMAGE="${SYNKLAB_IMAGE:-$NAME:latest}"
INBOX="${SYNKLAB_INBOX:-$HOME/SynkLab/Inbox}"
BIN="${SYNKLAB_BIN:-$HOME/.local/bin}"
ACTION="${1:-install}"

say() { printf '\033[1;32m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

need_docker() {
  command -v docker >/dev/null 2>&1 || die "Docker is not installed. Install it first: https://docs.docker.com/get-docker/"
  docker info >/dev/null 2>&1 || die "Docker is installed but not reachable (is the daemon running? is your user in the 'docker' group?)"
}

uninstall() {
  need_docker
  say "Removing container $NAME, image $IMAGE and $BIN/synklab-agent (your Inbox folder is kept)"
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  docker rmi "$IMAGE" >/dev/null 2>&1 || true
  rm -f "$BIN/synklab-agent"
  say "Done."
}

install() {
  need_docker
  case "$PORT" in ''|*[!0-9]*) die "SYNKLAB_PORT must be a number" ;; esac

  CTX="$SRC"
  if [ -z "$CTX" ]; then
    command -v curl >/dev/null 2>&1 || die "curl is required"
    command -v tar >/dev/null 2>&1 || die "tar is required"
    TMP="$(mktemp -d)"
    trap 'rm -rf "$TMP"' EXIT INT TERM
    say "Downloading $REPO@$REF"
    curl -fsSL "https://github.com/$REPO/archive/$REF.tar.gz" | tar -xz -C "$TMP" --strip-components=1 \
      || die "could not download https://github.com/$REPO/archive/$REF.tar.gz (is the repository public?)"
    CTX="$TMP"
  fi
  [ -f "$CTX/Dockerfile" ] || die "no Dockerfile in $CTX"

  say "Building image $IMAGE (first build takes a few minutes: it installs ffmpeg and yt-dlp)"
  docker build -t "$IMAGE" "$CTX"

  say "Starting container $NAME on http://localhost:$PORT"
  mkdir -p "$INBOX"
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  set -- -d --name "$NAME" --restart unless-stopped \
    -p "127.0.0.1:$PORT:8000" \
    -v "$INBOX:/data/inbox" \
    --user "$(id -u):$(id -g)"
  [ -n "${MUSICBRAINZ_USER_AGENT:-}" ] && set -- "$@" -e "MUSICBRAINZ_USER_AGENT=$MUSICBRAINZ_USER_AGENT"
  docker run "$@" "$IMAGE" >/dev/null || die "could not start the container (is port $PORT already in use? try SYNKLAB_PORT=8010)"

  i=0
  while [ "$i" -lt 40 ]; do
    status="$(docker inspect --format '{{.State.Health.Status}}' "$NAME" 2>/dev/null || echo unknown)"
    [ "$status" = "healthy" ] && break
    i=$((i + 1)); sleep 1
  done
  [ "$status" = "healthy" ] || die "the app did not become healthy. See: docker logs $NAME"

  mkdir -p "$BIN"
  cat > "$BIN/synklab-agent" <<EOF
#!/bin/sh
# Runs the AI DJ agent (shipped inside the container) against the app on port $PORT.
# Needs python3 and the logged-in \`claude\` or \`codex\` CLI on this machine.
docker exec $NAME cat /app/dj_agent.py | python3 - --base http://localhost:$PORT "\$@"
EOF
  chmod +x "$BIN/synklab-agent"

  say "SYNK//LAB is running: http://localhost:$PORT"
  echo "    Downloaded audio goes to: $INBOX"
  echo "    AI DJ agent: open the app, tick 'PERMITIR CONTROL POR AGENTE', then run"
  echo "        synklab-agent --provider claude --start      (add $BIN to PATH if the command is not found)"
  echo "    Logs: docker logs -f $NAME      Stop: docker stop $NAME      Remove: sh install.sh uninstall"
}

case "$ACTION" in
  install) install ;;
  uninstall) uninstall ;;
  *) die "unknown action '$ACTION' (use: install | uninstall)" ;;
esac
