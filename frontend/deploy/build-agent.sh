#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
[[ -f "$HOME/.cargo/env" ]] && source "$HOME/.cargo/env"

target="$(uname -s | tr '[:upper:]' '[:lower:]')-$(uname -m | sed 's/x86_64/x64/;s/aarch64/arm64/')"
mkdir -p frontend/bin
(cd agent && cargo build --release --locked)
cp agent/target/release/mirai-agent "frontend/bin/mirai-agent-$target"
echo "$target: built"

build_host="${MIRAI_AGENT_BUILD_HOST:-}"
if [[ -n "$build_host" && "$target" != linux-x64 ]]; then
  rsync -a --delete --exclude target agent/ "$build_host:.cache/mirai-agent-src/"
  ssh "$build_host" 'cd ~/.cache/mirai-agent-src && { command -v mise >/dev/null && mise exec rust -- cargo build --release --locked || cargo build --release --locked; }'
  scp -q "$build_host:.cache/mirai-agent-src/target/release/mirai-agent" frontend/bin/mirai-agent-linux-x64
  echo "linux-x64: built on $build_host"
fi
