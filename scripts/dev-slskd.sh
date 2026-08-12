#!/bin/bash
# Starts slskd (if not running) and the Notify backend in slskd mode.
# Usage: ./scripts/dev-slskd.sh
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Load .env so SLSKD_USERNAME/PASSWORD/API_KEY and Spotify creds are available.
if [ -f .env ]; then
  set -a
  . ./.env
  set +a
fi

# Resolve the slskd binary for the current platform/arch (same naming scheme
# as scripts/setup-slskd.mjs: slskd-<osx|linux>-<arm64|x64>/slskd).
case "$(uname -s)" in
  Darwin) OS="osx" ;;
  Linux)  OS="linux" ;;
  *) echo "Unsupported platform: slskd supports macOS and Linux." >&2; exit 1 ;;
esac
case "$(uname -m)" in
  arm64|aarch64) ARCH="arm64" ;;
  x86_64|amd64)  ARCH="x64" ;;
  *) echo "Unsupported architecture: $ARCH" >&2; exit 1 ;;
esac

SLSKD_BIN="bin/slskd-$OS-$ARCH/slskd"
CONFIG="bin/slskd.yml"

if [ ! -f "$CONFIG" ]; then
  echo "No slskd config found. Run 'npm run setup' first (set SLSKD_USERNAME/SLSKD_PASSWORD)."
  exit 1
fi

if ! lsof -iTCP:5030 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Starting slskd…"
  "$SLSKD_BIN" --config "$CONFIG" > data/slskd.log 2>&1 &
  sleep 4
  echo "slskd started (log: data/slskd.log)"
else
  echo "slskd already running on :5030"
fi

# A leftover backend (e.g. a bare 'node backend/src/index.js' started in mock
# mode without the Spotify/Soulseek env) silently steals :4000 and makes the
# search return nothing. Fail loudly instead of crashing invisibly.
if lsof -iTCP:4000 -sTCP:LISTEN >/dev/null 2>&1; then
  PID=$(lsof -tiTCP:4000 -sTCP:LISTEN)
  echo "ERROR: another process is already listening on :4000 (PID $PID)." >&2
  echo "It is likely a leftover backend. Stop it, then re-run:" >&2
  echo "  kill $PID && npm run dev:slskd" >&2
  exit 1
fi

export SOULSEEK_MODE=slskd
export SLSKD_API_KEY="${SLSKD_API_KEY:-$(cat bin/api-key.txt 2>/dev/null || true)}"
echo "Starting backend on http://localhost:4000 …"
node backend/src/index.js
