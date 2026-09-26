#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
[[ -f "$HOME/.cargo/env" ]] && source "$HOME/.cargo/env"
mkdir -p frontend/bin
(cd code && cargo build --release --locked)
cp code/target/release/mirai-code "frontend/bin/mirai-code-$(uname -s | tr '[:upper:]' '[:lower:]')-$(uname -m | sed 's/x86_64/x64/;s/aarch64/arm64/')"
echo "mirai-code: built for this machine"
