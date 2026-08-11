#!/bin/bash -p
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
SERVER="$ROOT/dist-motif/claude-science/motif-mcp-server.mjs"
APP_RESOURCE="$ROOT/dist-motif/claude-science/motif-mcp-app.html"
ARTIFACT_TEMPLATE="$ROOT/dist-motif/motif-template.html"

if [[ -n "${MOTIF_ROOT:-}" && "$MOTIF_ROOT" != "$ROOT" ]]; then
  echo "[motif-claude-science] MOTIF_ROOT does not match this connector checkout." >&2
  exit 1
fi

for required in "$SERVER" "$APP_RESOURCE" "$ARTIFACT_TEMPLATE"; do
  if [[ ! -f "$required" || -L "$required" ]]; then
    echo "[motif-claude-science] A required built connector file is missing or unsafe." >&2
    echo "[motif-claude-science] Rebuild the Motif artifact and Claude Science connector before reconnecting." >&2
    exit 1
  fi
done

NODE_BIN="${MOTIF_NODE_BIN:-}"
if [[ -n "$NODE_BIN" ]]; then
  if [[ "$NODE_BIN" != /* || ! -x "$NODE_BIN" ]]; then
    echo "[motif-claude-science] MOTIF_NODE_BIN must be an absolute executable path." >&2
    exit 1
  fi
else
  for candidate in \
    /opt/homebrew/bin/node \
    /usr/local/bin/node \
    /usr/local/opt/node/bin/node \
    /usr/bin/node \
    /bin/node; do
    if [[ -n "$candidate" && "$candidate" = /* && -x "$candidate" ]]; then
      NODE_BIN="$candidate"
      break
    fi
  done
fi

if [[ -z "$NODE_BIN" ]]; then
  echo "[motif-claude-science] Node.js was not found. Set MOTIF_NODE_BIN to an absolute executable path." >&2
  exit 1
fi

ENV_BIN="/usr/bin/env"
if [[ ! -x "$ENV_BIN" ]]; then
  echo "[motif-claude-science] A system env utility was not found." >&2
  exit 1
fi

RUNTIME_ENV=(
  "MOTIF_ROOT=$ROOT"
  "MOTIF_NODE_BIN=$NODE_BIN"
)
for key in HOME PATH TMPDIR LANG LC_ALL SystemRoot SystemDrive WINDIR; do
  value="${!key:-}"
  if [[ -n "$value" ]]; then
    RUNTIME_ENV+=("$key=$value")
  fi
done
if [[ "${MOTIF_MCP_TRACE:-}" == "1" || "${MOTIF_MCP_TRACE:-}" == "true" ]]; then
  RUNTIME_ENV+=("MOTIF_MCP_TRACE=${MOTIF_MCP_TRACE}")
fi

run_node_with_clean_environment() {
  "$ENV_BIN" -i "${RUNTIME_ENV[@]}" "$NODE_BIN" "$@"
}

NODE_SUPPORTED="$(run_node_with_clean_environment -p 'const [major, minor] = process.versions.node.split(".").map(Number); Number(major >= 24 || (major === 22 && minor >= 13))' 2>/dev/null || true)"
if [[ "$NODE_SUPPORTED" != "1" ]]; then
  echo "[motif-claude-science] Node.js 22.13 or newer (22.x) or 24 or newer is required." >&2
  exit 1
fi

cd "$ROOT"
exec "$ENV_BIN" -i "${RUNTIME_ENV[@]}" "$NODE_BIN" "$SERVER"
