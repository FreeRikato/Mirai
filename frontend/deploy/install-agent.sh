#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

hub="${MIRAI_AGENT_HUB:?set MIRAI_AGENT_HUB to the tailnet machine name of the hub, for example MIRAI_AGENT_HUB=homeserver}"
[[ $# -gt 0 ]] || { echo "usage: MIRAI_AGENT_HUB=<hub> install-agent.sh local|<ssh host>..." >&2; exit 1; }
target="$(uname -s | tr '[:upper:]' '[:lower:]')-$(uname -m | sed 's/x86_64/x64/;s/aarch64/arm64/')"

install_systemd() {
  pkill -x mirai-agent || true
  mkdir -p ~/.local/bin ~/.config/systemd/user
  mv /tmp/mirai-agent.new ~/.local/bin/mirai-agent
  mv /tmp/mirai-agent.service ~/.config/systemd/user/mirai-agent.service
  [[ "$(loginctl show-user "$USER" -p Linger --value 2>/dev/null)" == yes ]] || loginctl enable-linger "$USER" 2>/dev/null || sudo -n loginctl enable-linger "$USER" 2>/dev/null || echo "could not enable lingering, so the agent stops when you log out; fix with: sudo loginctl enable-linger $USER" >&2
  systemctl --user daemon-reload
  systemctl --user enable --now mirai-agent
  systemctl --user restart mirai-agent
}

for host in "$@"; do
  if [[ "$host" == "local" && "$target" == darwin-* ]]; then
    pkill -x mirai-agent || true
    mkdir -p ~/.local/bin ~/Library/LaunchAgents ~/Library/Logs
    cp "bin/mirai-agent-$target" ~/.local/bin/mirai-agent
    sed -e "s#__HOME__#$HOME#g" -e "s#__PATH__#$PATH#" -e "s#__HUB__#$hub#" deploy/dev.mirai.agent.plist > ~/Library/LaunchAgents/dev.mirai.agent.plist
    launchctl bootout "gui/$(id -u)/dev.mirai.agent" 2>/dev/null || true
    launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/dev.mirai.agent.plist
    echo "local: installed"
  elif [[ "$host" == "local" ]]; then
    cp "bin/mirai-agent-$target" /tmp/mirai-agent.new
    sed "s#__HUB__#$hub#" deploy/mirai-agent.service > /tmp/mirai-agent.service
    install_systemd
    echo "local: installed"
  else
    scp -q bin/mirai-agent-linux-x64 "$host:/tmp/mirai-agent.new"
    sed "s#__HUB__#$hub#" deploy/mirai-agent.service | ssh "$host" 'cat > /tmp/mirai-agent.service'
    { echo "set -e"; declare -f install_systemd; echo install_systemd; } | ssh "$host" "bash -s"
    echo "$host: installed"
  fi
done
