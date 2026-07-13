#!/usr/bin/env bash
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
    "$(command -v node 2>/dev/null || true)" \
    /opt/homebrew/bin/node \
    /usr/local/bin/node \
    /usr/local/opt/node/bin/node; do
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

NODE_MAJOR="$($NODE_BIN -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || true)"
if [[ ! "$NODE_MAJOR" =~ ^[0-9]+$ || "$NODE_MAJOR" -lt 22 ]]; then
  echo "[motif-claude-science] Node.js 22 or newer is required." >&2
  exit 1
fi

export MOTIF_ROOT="$ROOT"
cd "$ROOT"
exec "$NODE_BIN" "$SERVER"
