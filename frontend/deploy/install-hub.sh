#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
host="${1:?usage: install-hub.sh <host>}"
port="$(sed -n 's/.*[[:space:]]PORT=\([0-9][0-9]*\).*/\1/p' deploy/mirai-hub.service)"
[ -n "$port" ] || { echo "no PORT= in deploy/mirai-hub.service" >&2; exit 1; }

rsync -az --delete --exclude node_modules --exclude .env --exclude data --exclude bin --exclude test-results --exclude playwright-report --exclude dist ./ "$host:mirai/"
rsync -az --delete --exclude target ../code/ "$host:.cache/mirai-code-src/"
ssh "$host" "export PORT=$port;"'
  set -e
  cd ~/mirai
  mkdir -p data ~/.config/systemd/user ~/.config/mirai
  [ -f ~/.config/mirai/hub.env ] || printf "%s\n" "# mirai hub settings for this host (not deployed, not in git)" "# every variable is listed in ~/mirai/.env.example" "#MIRAI_VAULT_DIR=/absolute/path/to/obsidian/vault" "#LINEAR_API_KEY=" > ~/.config/mirai/hub.env
  chmod 600 ~/.config/mirai/hub.env
  mise=$(command -v mise) || { echo "mise is not installed on this host" >&2; exit 1; }
  "$mise" exec bun -- bun install --frozen-lockfile
  "$mise" exec bun -- bun run build
  (cd ~/.cache/mirai-code-src && "$mise" exec rust -- cargo build --release --locked --quiet)
  mkdir -p bin && cp ~/.cache/mirai-code-src/target/release/mirai-code bin/mirai-code-linux-x64.new && mv -f bin/mirai-code-linux-x64.new bin/mirai-code-linux-x64
  px0=0.1.10
  if [ "$(bin/px0-linux-x64 -version 2>/dev/null | cut -d" " -f2)" != "$px0" ]; then
    release="https://github.com/px0-ai/px0/releases/download/v$px0"
    curl -fsSL -o bin/px0-linux-x64.new "$release/px0-$px0-linux-amd64"
    curl -fsSL "$release/checksums.txt" | awk -v f="px0-$px0-linux-amd64" "\$2 == f { print \$1 \"  bin/px0-linux-x64.new\" }" | sha256sum --check --status
    chmod +x bin/px0-linux-x64.new && mv -f bin/px0-linux-x64.new bin/px0-linux-x64
  fi
  sed "s#__MISE__#$mise#" deploy/mirai-hub.service > ~/.config/systemd/user/mirai-hub.service
  systemctl --user daemon-reload
  systemctl --user enable mirai-hub
  systemctl --user restart mirai-hub
  tailscale serve --bg --https=443 "http://127.0.0.1:$PORT" >/dev/null'
echo "$host: hub deployed, https://$host.$(tailscale status --json | jq -r .MagicDNSSuffix)"
