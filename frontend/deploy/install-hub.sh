#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
host="${1:?usage: install-hub.sh local|<ssh host>}"
port="$(sed -n 's/.*[[:space:]]PORT=\([0-9][0-9]*\).*/\1/p' deploy/mirai-hub.service)"
[ -n "$port" ] || { echo "no PORT= in deploy/mirai-hub.service" >&2; exit 1; }

serve_hint="could not run tailscale serve. On Linux run once: sudo tailscale set --operator=\$USER. Also turn on MagicDNS and HTTPS Certificates at https://login.tailscale.com/admin/dns, then run: tailscale serve --bg --https=443 http://127.0.0.1:$port"

if [[ "$host" == "local" ]]; then
  bun="$(command -v bun)" || { echo "bun is not on PATH" >&2; exit 1; }
  bun install --frozen-lockfile
  bun run build
  if command -v cargo >/dev/null; then deploy/build-code.sh; fi
  mkdir -p data
  if [[ "$(uname -s)" == Darwin ]]; then
    mkdir -p ~/Library/LaunchAgents ~/Library/Logs
    sed -e "s#__DIR__#$PWD#g" -e "s#__BUN__#$bun#" -e "s#__HOME__#$HOME#g" -e "s#__PATH__#$PATH#" -e "s#__PORT__#$port#" deploy/dev.mirai.hub.plist > ~/Library/LaunchAgents/dev.mirai.hub.plist
    launchctl bootout "gui/$(id -u)/dev.mirai.hub" 2>/dev/null || true
    launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/dev.mirai.hub.plist
  else
    mkdir -p ~/.config/systemd/user ~/.config/mirai
    [ -f ~/.config/mirai/hub.env ] || printf "%s\n" "# mirai hub settings for this host (not in git); every variable is listed in .env.example" > ~/.config/mirai/hub.env
    chmod 600 ~/.config/mirai/hub.env
    sed -e "s#__DIR__#$PWD#" -e "s#__BUN__#$bun#" deploy/mirai-hub.service > ~/.config/systemd/user/mirai-hub.service
    [[ "$(loginctl show-user "$USER" -p Linger --value 2>/dev/null)" == yes ]] || loginctl enable-linger "$USER" 2>/dev/null || sudo -n loginctl enable-linger "$USER" 2>/dev/null || echo "could not enable lingering, so the hub stops when you log out; fix with: sudo loginctl enable-linger $USER" >&2
    systemctl --user daemon-reload
    systemctl --user enable mirai-hub
    systemctl --user restart mirai-hub
  fi
  tailscale serve --bg --https=443 "http://127.0.0.1:$port" >/dev/null 2>&1 </dev/null &
  serving=$!
  for _ in $(seq 20); do kill -0 "$serving" 2>/dev/null || break; sleep 1; done
  if kill -0 "$serving" 2>/dev/null; then kill "$serving"; echo "$serve_hint" >&2; elif ! wait "$serving"; then echo "$serve_hint" >&2; fi
  echo "local: hub running on http://127.0.0.1:$port"
  exit 0
fi

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
  sed -e "s#__DIR__#%h/mirai#" -e "s#__BUN__#$mise exec bun -- bun#" deploy/mirai-hub.service > ~/.config/systemd/user/mirai-hub.service
  systemctl --user daemon-reload
  systemctl --user enable mirai-hub
  systemctl --user restart mirai-hub
  tailscale serve --bg --https=443 "http://127.0.0.1:$PORT" >/dev/null'
echo "$host: hub deployed, https://$host.$(tailscale status --json | jq -r .MagicDNSSuffix)"
