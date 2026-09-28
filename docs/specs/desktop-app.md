# Desktop app on Omarchy

Mirai on an Omarchy machine should feel like an Omarchy app while the React app stays the only UI. Vocabulary follows `CONTEXT.md` (Desktop app, Browser tab, PWA, System theme, Content). The why is in `docs/adr/0002-desktop-app-is-an-omarchy-web-app.md`.

Machines: archikato (hub and agent) and omarikato (agent only). macato is untouched apart from the next agent deploy.

## Behaviour

### Launching

- `SUPER+M` focuses the Desktop app or launches it on `/machines`.
- `SUPER+ALT+M` does the same and opens the mirAI panel with the input focused.
- Mirai tiles like any other app. The window rule only makes it fully opaque; no fixed workspace, no floating.
- The launcher entry is named "Mirai" and uses `frontend/public/icons/icon-512.png`.

### System theme

- The Desktop app follows its own machine's Omarchy theme and monospace font, live. The Browser tab and the PWA never do.
- The theme covers background, text, the greys, accent and links, and machine colors. Status colors (ok, warn, bad) are never taken from the theme.
- A light theme (`mode = "light"`) turns the Desktop app light and switches status colors to a fixed darker set.
- Accent placement (mock B, picked): links, the focus ring, the active nav tab and its underline, the ship badge count, the command palette border, fleet graph edges, and the selected table row (`selection` color). Titles and body text stay in the text color; greys are not tinted.
- `--font-mono` becomes the system monospace font. Doto, Inter and Source Serif stay.
- No System theme reported (macato, an old agent, a non-Omarchy machine) means Mirai's built-in look, silently.

### Bar widget

- Popup layout is the table (mock A, picked): one row per machine with CPU, memory, temperature and fullest disk as numbers, a value turning warn or bad colored past its limit, then the last 3 events.
- Shows the Mirai glyph, a dot for the worst machine state (ok, warn, bad; grey when the hub is unreachable), machines online over total, and PRs waiting on review: `󰣇 ● 3/3 · 9`.
- Hover popup: per machine CPU, memory, temperature and fullest disk, then the last 3 events. When the hub is unreachable the popup says so; no notification about it.
- Click opens the Desktop app like `SUPER+M`.
- Sits in the right section, just left of the clock.
- Polls `/api/fleet`, `/api/events` and `/api/ship/badge` every 10 s, with a stall timer on every Process.

### Notifications

- Sent by the bar widget, so they work while the Desktop app is closed.
- Only `bad` events (hot, disk full, failed service), at critical urgency. `warn` and `info` appear only in the popup.
- On start the widget treats the newest existing event as seen, so restarts do not replay alerts.
- Clicking a notification opens the Desktop app on `/machines/<machine>`.

### Omarchy menu

A "Mirai" submenu with: Open Mirai, Ask mirAI, Save copied URL to Content, and Go to (machines, projects, tasks, ship, content, notes, stats). Save copied URL accepts only http(s) URLs and confirms with "Saved to Content", "Clipboard has no URL", or the hub's error.

### Driving an already open Desktop app

Focusing an existing `--app` window cannot pass it a URL, so every entry point (keys, menu, widget, notification) goes through one launcher:

```
mirai-desktop-open <path>
  window exists? yes -> POST hub /api/desktop/open {machine, path}
                        delivered > 0 ? focus window : launch
                 no  -> launch <hub><path>?desktop=<machine>
```

## Contracts (freeze before parallel work)

1. **Agent report.** `MetricsSchema` gains optional `system: { mode: "dark" | "light"; colors: Record<string, string>; monoFont: string }`. `colors` carries the `colors.toml` keys as-is. Absent when `~/.local/state/omarchy/current/theme/colors.toml` does not exist. The font is `fc-match monospace` family, first entry, re-read only when fontconfig changes.
2. **Desktop mode.** The launch URL carries `?desktop=<machine>`; the app keeps it in sessionStorage for the life of the window. Without it the app behaves exactly as today.
3. **mirAI deep link.** `?mirai=1` opens the mirAI panel with the input focused, then drops the param from the URL.
4. **Open relay.** `POST /api/desktop/open {machine, path}` (path must start with `/`) publishes `{ type: "open", path }` on topic `desktop:<machine>` and answers `{ delivered: number }`. The Desktop app subscribes with a `{ type: "desktop", machine }` socket message.
5. **Theme mapping.** `bg <- background`, `fg <- foreground`, `link <- accent`. `dim` and `soft` are `color-mix` of fg into bg (about 58% and 82%): the theme's `muted` and `dark_foreground` are too faint for text in Tokyo Night and Catppuccin Latte. The greys (`rule`, `track`, `raise`, `sunk`, `hover`, `lift`, `drop`, `faint`, popover, ring) are `color-mix` of fg into bg at the ratios today's hexes imply. Status sets: dark `#5fd08a #f4b63f #ff5a4e`, light `#1f8a4c #a86400 #c8302a`. Machine colors 1 to 8 <- blue, magenta, cyan, orange, bright_blue, bright_magenta, bright_cyan, brown, each falling back to today's value.

## Install

`frontend/deploy/install-desktop.sh local|<host>...` in the style of `install-agent.sh`. Safe to re-run; `--remove` undoes everything. It writes the hub URL once (`MIRAI_DESKTOP_HUB`, else derived from `tailscale status`) and installs: the web app entry (custom exec = the launcher), the launcher script, the keybindings and window rule in a marked block, the bar plugin plus its bar position, and the menu entries. `bun run doctor` gains desktop checks: web app registered, bindings present, widget installed, System theme being reported.

The agent is rebuilt and redeployed on archikato and omarikato.

## Known trade-off

The System theme rides the existing fleet updates: every 2 s while a machines page is open, every 15 s otherwise. A theme switch can therefore take up to 15 s to reach the Desktop app when it is on another page.

## Tests

- Rust: `colors.toml` and the font land in the agent report; no theme file means no `system`.
- Bun: the theme mapping (dark, light, missing keys) and the open relay.
- Playwright: desktop mode takes the theme, `?mirai=1` opens the panel, the Browser tab ignores both.
- On archikato: `omarchy theme set` across Berserk, Tokyo Night and Catppuccin Latte with `grim` screenshots; widget and a forced `bad` event checked by hand.

## Order

1. HTML mocks: done and picked (theme B, widget A). Copies in `docs/specs/desktop-app-mocks/`.
2. Freeze the contracts above.
3. In parallel, each chunk owning its files:
   - **A, agent**: `agent/src/**`.
   - **B, hub and web**: `frontend/src/hub/**`, `frontend/src/web/**`, `frontend/src/index.ts`, `frontend/styles/**`, `frontend/e2e/**`.
4. **C, Omarchy side**, after B: `frontend/deploy/install-desktop.sh`, `frontend/deploy/desktop/**`, `frontend/src/doctor/**`.
