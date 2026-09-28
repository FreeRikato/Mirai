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

mark_created() {
  local path=$1
  [[ -e "$path" ]] || : > "$path.mirai.created"
}

append_block() {
  local path=$1
  local body=$2
  mkdir -p "$(dirname "$path")"
  if ! grep -Fq "$MARK_BEGIN" "$path" 2>/dev/null; then
    if [[ -s "$path" && "$(tail -c 1 "$path"; printf x)" != $'\nx' ]]; then printf '\n' >> "$path"; fi
    printf '%b\n' "$body" >> "$path"
  fi
}

remove_marked_block() {
  local path=$1
  [[ -f "$path" ]] || return 0
  python3 - "$path" "$MARK_BEGIN" "$MARK_END" <<'PY'
import sys

path, begin, end = sys.argv[1:]
with open(path, encoding="utf-8") as handle:
    lines = handle.readlines()
if not any(begin in line for line in lines):
    raise SystemExit(0)
result = []
skipping = False
for line in lines:
    if not skipping and begin in line:
        skipping = True
        continue
    if skipping:
        if end in line:
            skipping = False
        continue
    result.append(line)
with open(path, "w", encoding="utf-8") as handle:
    handle.writelines(result)
PY
}

# Strips the marked block; deletes the file only when Mirai created it (no
# .mirai.created marker means it was already there before install) and
# nothing but that block is left in it.
remove_marked_lua() {
  local path=$1
  if [[ ! -f "$path" ]]; then
    rm -f "$path.mirai.created"
    return 0
  fi
  remove_marked_block "$path"
  if [[ -e "$path.mirai.created" ]]; then
    [[ -s "$path" ]] || rm -f "$path"
    rm -f "$path.mirai.created"
  fi
}

remove_marked_menu() {
  local path=$1
  if [[ ! -f "$path" ]]; then
    rm -f "$path.mirai.created"
    return 0
  fi
  remove_marked_block "$path"
  if [[ -e "$path.mirai.created" ]]; then
    if python3 - "$path" <<'PY'
import re
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    text = handle.read()
# Only the empty skeleton Mirai wrote may go: a user comment keeps the file.
sys.exit(0 if re.sub(r"\s+", "", text) in ("{}", "") else 1)
PY
    then
      rm -f "$path"
    fi
    rm -f "$path.mirai.created"
  fi
}

remove_shell_entry() {
  local path=$1
  [[ -f "$path" ]] || return 0
  python3 - "$path" <<'PY'
import json
import sys

path = sys.argv[1]
with open(path, encoding="utf-8") as handle:
    config = json.load(handle)
layout = config.get("bar", {}).get("layout", {})
for section in ("left", "center", "right"):
    entries = layout.get(section)
    if isinstance(entries, list):
        layout[section] = [entry for entry in entries if not (isinstance(entry, dict) and entry.get("id") == "mirai.fleet")]
with open(path, "w", encoding="utf-8") as handle:
    json.dump(config, handle, indent=2, ensure_ascii=False)
    handle.write("\n")
PY
}

hub_from_tailscale() {
  local name
  name=$(tailscale status --json | python3 -c 'import json, sys; print(json.load(sys.stdin)["Self"].get("DNSName", "").rstrip("."))')
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
import os
import re
import shlex
import sys

path, hub, begin, end = sys.argv[1:]
if os.path.exists(path):
    with open(path, encoding="utf-8") as handle:
        text = handle.read()
else:
    text = "{\n}\n"
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
def object_brace(source):
    # The first brace outside comments and strings: a leading comment may mention one.
    i, n = 0, len(source)
    while i < n:
        if source.startswith("//", i):
            i = source.find("\n", i)
            i = n if i < 0 else i
        elif source.startswith("/*", i):
            i = source.find("*/", i + 2)
            i = n if i < 0 else i + 2
        elif source[i] == '"':
            i += 1
            while i < n and source[i] != '"':
                i += 2 if source[i] == "\\" else 1
            i += 1
        elif source[i] == "{":
            return i
        else:
            i += 1
    return -1

position = object_brace(text)
if position < 0:
    raise SystemExit(f"{path} is not a JSONC object")
insert_at = position + 1
rest = re.sub(r"^\n+", "", text[insert_at:])
insert = "\n" + "\n".join(block) + "\n"
text = text[:insert_at] + insert + rest
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
  exec omarchy-launch-webapp "\$url"
elif command -v omarchy-launch-or-focus-webapp >/dev/null 2>&1; then
  exec omarchy-launch-or-focus-webapp mirai "\$url"
elif command -v uwsm-app >/dev/null 2>&1; then
  exec uwsm-app -- chromium --app="\$url"
elif command -v chromium >/dev/null 2>&1; then
  exec chromium --app="\$url"
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

  mkdir -p "$HOME/.config/omarchy" "$HOME/.config/hypr" "$HOME/.config/omarchy/extensions" "$HOME/.config/omarchy/plugins" "$PLUGIN_DIR" "$HOME/.local/share/applications" "$HOME/.local/share/icons/hicolor/512x512/apps" "$HOME/.local/bin"

  mark_created "$bindings"
  mark_created "$hyprland"
  mark_created "$menu"

  append_block "$bindings" "-- $MARK_BEGIN\nhl.unbind(\"SUPER + M\")\nhl.unbind(\"SUPER + ALT + M\")\no.bind(\"SUPER + M\", \"Mirai\", \"mirai-desktop-open /machines\")\no.bind(\"SUPER + ALT + M\", \"Ask mirAI\", \"mirai-desktop-open '/machines?mirai=1'\")\n-- $MARK_END"
  append_block "$hyprland" "-- $MARK_BEGIN\n-- Chromium ignores --class on Wayland and names app windows after the launch URL, so match the fixed page title.\no.window({ class = \"^chrome-\", title = \"^mirai$\" }, { tag = \"-default-opacity\", opacity = \"1 1\" })\n-- $MARK_END"

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

  rm -rf "$PLUGIN_DIR"
  rm -f "$launcher" "$desktop" "$icon"
  remove_shell_entry "$shell_json"
  remove_marked_lua "$bindings"
  remove_marked_lua "$hyprland"
  remove_marked_menu "$menu"
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
