#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
FRONTEND_DIR=$(cd "$SCRIPT_DIR/.." && pwd)
PLUGIN_ID="mirai.fleet"
PLUGIN_DIR="$HOME/.config/omarchy/plugins/$PLUGIN_ID"
MARK_BEGIN="MIRAI DESKTOP BEGIN"
MARK_END="MIRAI DESKTOP END"

quote() {
  printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\''/g")"
}

backup_file() {
  local path=$1
  mkdir -p "$(dirname "$path")"
  if [[ -e "$path.mirai.missing" ]]; then
    :
  elif [[ -e "$path" || -L "$path" ]]; then
    [[ -e "$path.mirai.bak" || -L "$path.mirai.bak" ]] || cp -a "$path" "$path.mirai.bak"
  else
    [[ -e "$path.mirai.missing" ]] || : > "$path.mirai.missing"
  fi
}

restore_file() {
  local path=$1
  if [[ -e "$path.mirai.bak" || -L "$path.mirai.bak" ]]; then
    rm -rf "$path"
    mv "$path.mirai.bak" "$path"
  elif [[ -e "$path.mirai.missing" ]]; then
    rm -rf "$path"
  fi
  rm -f "$path.mirai.missing"
}

append_block() {
  local path=$1
  local body=$2
  mkdir -p "$(dirname "$path")"
  if ! grep -Fq "$MARK_BEGIN" "$path" 2>/dev/null; then
    if [[ -s "$path" && "$(tail -c 1 "$path")" != $'\n' ]]; then printf '\n' >> "$path"; fi
    printf '%b\n' "$body" >> "$path"
  fi
}

hub_from_tailscale() {
  local name
  name=$(tailscale status --json | python3 -c 'import json, sys; print(json.load(sys)["Self"].get("DNSName", "").rstrip("."))')
  [[ -n "$name" ]] || { echo "could not derive the hub URL from tailscale status; set MIRAI_DESKTOP_HUB" >&2; return 1; }
  printf 'http://%s:3131' "$name"
}

hub_url() {
  local value=${MIRAI_DESKTOP_HUB:-}
  [[ -n "$value" ]] || value=$(hub_from_tailscale)
  value=${value%/}
  [[ "$value" == http://* || "$value" == https://* ]] || { echo "MIRAI_DESKTOP_HUB must start with http:// or https://" >&2; return 1; }
  printf '%s' "$value"
}

update_shell_layout() {
  local shell_json=$1
  local hub=$2
  python3 - "$shell_json" "$hub" <<'PY'
import json
import sys

path, hub = sys.argv[1:]
with open(path, encoding="utf-8") as handle:
    config = json.load(handle)
bar = config.setdefault("bar", {})
layout = bar.setdefault("layout", {})
for section in ("left", "center", "right"):
    layout.setdefault(section, [])
right = layout["right"]
right[:] = [entry for entry in right if entry.get("id") != "mirai.fleet"]
entry = {"id": "mirai.fleet", "hub": hub}
clock = next((index for index, item in enumerate(right) if item.get("id") == "omarchy.clock"), None)
if clock is None:
    right.append(entry)
else:
    right.insert(clock, entry)
with open(path, "w", encoding="utf-8") as handle:
    json.dump(config, handle, indent=2, ensure_ascii=False)
    handle.write("\n")
PY
}

update_menu() {
  local menu=$1
  local hub=$2
  python3 - "$menu" "$hub" "$MARK_BEGIN" "$MARK_END" <<'PY'
import json
import shlex
import sys

path, hub, begin, end = sys.argv[1:]
with open(path, encoding="utf-8") as handle:
    text = handle.read()
if begin in text:
    raise SystemExit(0)

save_action = f'''hub={shlex.quote(hub)}; url="$(wl-paste --no-newline 2>/dev/null || true)"; url="$(printf '%s' "$url" | tr -d '\\r\\n')"; if [[ "$url" =~ ^https?://[^[:space:]]+$ ]]; then escaped="$(printf '%s' "$url" | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g')"; response="$(curl -sS -w '\\n%{{http_code}}' -X POST -H 'Content-Type: application/json' --data "{{\\"url\\":\\"$escaped\\"}}" "$hub/api/later" 2>&1)"; status="${{response##*$'\\n'}}"; body="${{response%$'\\n'*}}"; if [[ "$status" == 2?? ]]; then notify-send "Mirai" "Saved to Content"; else error="$(printf '%s' "$body" | sed -n 's/.*"error"[[:space:]]*:[[:space:]]*"\\([^"\\]*\\)".*/\\1/p')"; notify-send "Mirai" "${{error:-Could not save URL}}"; fi; else notify-send "Mirai" "Clipboard has no URL"; fi'''
entries = [
    ("mirai", {"icon": "󰣇", "label": "Mirai"}),
    ("mirai.open", {"icon": "󰖟", "label": "Open Mirai", "action": "mirai-desktop-open /machines"}),
    ("mirai.ask", {"icon": "󰭹", "label": "Ask mirAI", "action": "mirai-desktop-open '/machines?mirai=1'"}),
    ("mirai.save", {"icon": "󰗆", "label": "Save copied URL to Content", "action": save_action}),
    ("mirai.go-to", {"icon": "", "label": "Go to"}),
]
for module in ("machines", "projects", "tasks", "ship", "content", "notes", "stats"):
    entries.append((f"mirai.go-to.{module}", {"icon": "", "label": module.title(), "action": f"mirai-desktop-open /{module}"}))

block = [f"// {begin}"]
for key, value in entries:
    block.append(f"  {json.dumps(key)}: {json.dumps(value, ensure_ascii=False)},")
block.append(f"// {end}")
insert = "\n" + "\n".join(block) + "\n"
position = text.rfind("}")
if position < 0:
    raise SystemExit(f"{path} is not a JSONC object")
text = text[:position] + insert + text[position:]
with open(path, "w", encoding="utf-8") as handle:
    handle.write(text)
PY
}

write_launcher() {
  local path=$1
  local hub=$2
  cat > "$path" <<EOF
#!/usr/bin/env bash
set -euo pipefail

hub=$(quote "$hub")
path=\${1:-/machines}
[[ "\$path" == /* ]] || { echo "mirai-desktop-open expects a path beginning with /" >&2; exit 2; }
machine=\$(hostname)
if [[ "\$path" == *\?* ]]; then
  url="\${hub}\${path}&desktop=\${machine}"
else
  url="\${hub}\${path}?desktop=\${machine}"
fi

clients=\$(hyprctl -j clients 2>/dev/null || true)
address=\$(printf '%s' "\$clients" | python3 -c 'import json,sys; clients=json.load(sys.stdin); print(next((c.get("address", "") for c in clients if str(c.get("title", "")).lower() == "mirai" or str(c.get("initialTitle", "")).lower() == "mirai"), ""))' 2>/dev/null || true)
if [[ -n "\$address" ]]; then
  body=\$(printf '{"machine":"%s","path":"%s"}' "\$machine" "\$path")
  response=\$(curl -fsS -X POST -H 'Content-Type: application/json' --data "\$body" "\${hub}/api/desktop/open" 2>/dev/null || true)
  if printf '%s' "\$response" | grep -Eq '"delivered"[[:space:]]*:[[:space:]]*[1-9][0-9]*'; then
    hyprctl dispatch focuswindow "address:\$address" >/dev/null 2>&1 || true
    exit 0
  fi
fi
if command -v omarchy-launch-webapp >/dev/null 2>&1; then
  exec omarchy-launch-webapp "\$url" --class=mirai
elif command -v omarchy-launch-or-focus-webapp >/dev/null 2>&1; then
  exec omarchy-launch-or-focus-webapp mirai "\$url" --class=mirai
elif command -v uwsm-app >/dev/null 2>&1; then
  exec uwsm-app -- chromium --app="\$url" --class=mirai
elif command -v chromium >/dev/null 2>&1; then
  exec chromium --app="\$url" --class=mirai
else
  exec xdg-open "\$url"
fi
EOF
  chmod 0755 "$path"
}

install_local() {
  local hub=$1
  local shell_json="$HOME/.config/omarchy/shell.json"
  local bindings="$HOME/.config/hypr/bindings.lua"
  local hyprland="$HOME/.config/hypr/hyprland.lua"
  local menu="$HOME/.config/omarchy/extensions/omarchy-menu.jsonc"
  local desktop="$HOME/.local/share/applications/mirai.desktop"
  local icon="$HOME/.local/share/icons/hicolor/512x512/apps/mirai.png"
  local launcher="$HOME/.local/bin/mirai-desktop-open"

  for path in "$shell_json" "$bindings" "$hyprland" "$menu" "$desktop" "$icon"; do backup_file "$path"; done
  mkdir -p "$HOME/.config/omarchy" "$HOME/.config/hypr" "$HOME/.config/omarchy/extensions" "$HOME/.config/omarchy/plugins" "$PLUGIN_DIR" "$HOME/.local/share/applications" "$HOME/.local/share/icons/hicolor/512x512/apps" "$HOME/.local/bin"

  append_block "$bindings" "-- $MARK_BEGIN\nhl.unbind(\"SUPER + M\")\nhl.unbind(\"SUPER + ALT + M\")\no.bind(\"SUPER + M\", \"Mirai\", \"mirai-desktop-open /machines\")\no.bind(\"SUPER + ALT + M\", \"Ask mirAI\", \"mirai-desktop-open '/machines?mirai=1'\")\n-- $MARK_END"
  append_block "$hyprland" "-- $MARK_BEGIN\no.window(\"mirai\", { opacity = 1.0 })\n-- $MARK_END"

  update_shell_layout "$shell_json" "$hub"
  update_menu "$menu" "$hub"

  cp "$SCRIPT_DIR/desktop/manifest.json" "$PLUGIN_DIR/manifest.json"
  cp "$SCRIPT_DIR/desktop/Fleet.qml" "$PLUGIN_DIR/Fleet.qml"
  cp "$SCRIPT_DIR/desktop/fleet.mjs" "$PLUGIN_DIR/fleet.mjs"
  cp "${MIRAI_DESKTOP_ICON:-$FRONTEND_DIR/public/icons/icon-512.png}" "$icon"
  cat > "$desktop" <<EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=Mirai
Comment=Mirai fleet dashboard
Exec=$launcher /machines
Icon=mirai
Terminal=false
Categories=Network;Utility;
StartupWMClass=mirai
EOF
  write_launcher "$launcher" "$hub"
  if command -v omarchy-restart-shell >/dev/null 2>&1; then omarchy-restart-shell >/dev/null 2>&1 || true; fi
  echo "local: installed"
}

remove_local() {
  local shell_json="$HOME/.config/omarchy/shell.json"
  local bindings="$HOME/.config/hypr/bindings.lua"
  local hyprland="$HOME/.config/hypr/hyprland.lua"
  local menu="$HOME/.config/omarchy/extensions/omarchy-menu.jsonc"
  local desktop="$HOME/.local/share/applications/mirai.desktop"
  local icon="$HOME/.local/share/icons/hicolor/512x512/apps/mirai.png"
  local launcher="$HOME/.local/bin/mirai-desktop-open"

  rm -rf "$PLUGIN_DIR" "$launcher"
  restore_file "$shell_json"
  restore_file "$bindings"
  restore_file "$hyprland"
  restore_file "$menu"
  restore_file "$desktop"
  restore_file "$icon"
  if command -v omarchy-restart-shell >/dev/null 2>&1; then omarchy-restart-shell >/dev/null 2>&1 || true; fi
  echo "local: removed"
}

remove=0
if [[ ${1:-} == "--remove" ]]; then
  remove=1
  shift
fi
[[ $# -gt 0 ]] || { echo "usage: install-desktop.sh [--remove] local|<ssh host>..." >&2; exit 1; }

hub=""
if (( ! remove )); then hub=$(hub_url)
fi
for host in "$@"; do
  if [[ "$host" == "local" ]]; then
    if (( remove )); then remove_local; else install_local "$hub"; fi
    continue
  fi
  remote_dir="/tmp/mirai-desktop-install-$$"
  ssh "$host" "mkdir -p '$remote_dir/desktop'"
  scp -q "$SCRIPT_DIR/install-desktop.sh" "${MIRAI_DESKTOP_ICON:-$FRONTEND_DIR/public/icons/icon-512.png}" "$host:$remote_dir/"
  scp -q "$SCRIPT_DIR/desktop/manifest.json" "$SCRIPT_DIR/desktop/Fleet.qml" "$SCRIPT_DIR/desktop/fleet.mjs" "$host:$remote_dir/desktop/"
  if (( remove )); then
    ssh "$host" "HOME=\"\$HOME\" bash '$remote_dir/install-desktop.sh' --remove local; rm -rf '$remote_dir'"
  else
    ssh "$host" "MIRAI_DESKTOP_HUB=$(quote "$hub") MIRAI_DESKTOP_ICON='$remote_dir/icon-512.png' bash '$remote_dir/install-desktop.sh' local; rm -rf '$remote_dir'"
  fi
  echo "$host: $([[ $remove -eq 1 ]] && echo removed || echo installed)"
done
