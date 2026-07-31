#!/usr/bin/env bash
# Keep Vite preview + tunnels alive for this cloud agent session.
# Prefer the permanent GitHub Pages URL once enabled; tunnels are a fallback.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMUX_CFG=/exec-daemon/tmux.portal.conf
URL_FILE=/tmp/preview-urls.txt

ensure_session() {
  local name="$1"
  tmux -f "$TMUX_CFG" has-session -t "=$name" 2>/dev/null \
    || tmux -f "$TMUX_CFG" new-session -d -s "$name" -c "$ROOT" -- "${SHELL:-bash}" -l
}

restart_cmd() {
  local name="$1"
  shift
  ensure_session "$name"
  tmux -f "$TMUX_CFG" send-keys -t "$name:0.0" C-c
  sleep 1
  tmux -f "$TMUX_CFG" send-keys -t "$name:0.0" "$*" C-m
}

write_urls() {
  {
    echo "updated=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "pages=https://lutherfergus.github.io/mosaic-image-creator/"
    local lhr
    lhr=$(grep -oE 'https://[a-z0-9]+\.lhr\.life' /tmp/sshtun.log 2>/dev/null | tail -1 || true)
    local bore
    bore=$(grep -oE 'bore\.pub:[0-9]+' /tmp/bore.log 2>/dev/null | tail -1 || true)
    local cf
    cf=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' /tmp/cf-tunnel.log 2>/dev/null | tail -1 || true)
    echo "lhr=${lhr:-}"
    echo "bore=${bore:+http://$bore}"
    echo "cf=${cf:-}"
  } >"$URL_FILE"
  cat "$URL_FILE"
}

# Ensure production build exists
if [[ ! -f "$ROOT/dist/index.html" ]]; then
  (cd "$ROOT" && npm run build)
fi

# Vite preview
if ! curl -sf -o /dev/null --max-time 3 http://127.0.0.1:5173/; then
  restart_cmd vite-preview 'npx vite preview --host 0.0.0.0 --port 5173'
  sleep 2
fi

# localhost.run with reconnect loop
restart_cmd sshtun 'while true; do ssh -o StrictHostKeyChecking=no -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -R 80:127.0.0.1:5173 nokey@localhost.run 2>&1 | tee -a /tmp/sshtun.log; echo RECONNECT $(date -u) | tee -a /tmp/sshtun.log; sleep 2; done'

# bore backup
if [[ ! -x /tmp/bore ]]; then
  curl -sL https://github.com/ekzhang/bore/releases/download/v0.5.1/bore-v0.5.1-x86_64-unknown-linux-musl.tar.gz -o /tmp/bore.tgz
  tar -xzf /tmp/bore.tgz -C /tmp
fi
restart_cmd bore-tunnel 'while true; do /tmp/bore local 5173 --to bore.pub 2>&1 | tee -a /tmp/bore.log; echo RECONNECT $(date -u) | tee -a /tmp/bore.log; sleep 2; done'

sleep 14
write_urls
echo "URL file: $URL_FILE"
