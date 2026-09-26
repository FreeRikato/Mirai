# Mirai

A personal dashboard for people who work across several machines. One hub shows every computer on your Tailscale network, your tasks, your pull requests, your saved reading and videos, your Obsidian notes and your AI coding spend, with an assistant (mirAI) that can answer questions about all of it.

![Mirai fleet overview](docs/screenshots/machines.webp)

| Page | What it shows | Needs |
| --- | --- | --- |
| machines | CPU, memory, temperature, disks, processes, ports and failed services for every machine, with history and alerts | Tailscale, the agent on each machine |
| projects | git worktrees, dev servers and Docker containers per machine | the agent |
| tasks | Obsidian daily-note tasks, Linear issues and GitHub issues, ranked by priority | a vault, `LINEAR_API_KEY`, a GitHub token, `OPENROUTER_API_KEY` for ranking |
| ship | open pull requests in one GitHub org, with review and syntax-highlighted diffs | `MIRAI_SHIP_ORG`, a GitHub token |
| content | read-later articles, YouTube videos with local transcripts, posts and PDFs | nothing; `yt-dlp` and the ASR setup for playlists and transcripts |
| notes | your Obsidian vault in the browser | `MIRAI_VAULT_DIR` |
| stats | Claude Code and Codex token usage, cost and plan limits per machine | the agent |
| mirAI | an assistant in the side panel with shell access on the hub | `OPENAI_API_KEY` |

Every integration is optional. Without its key a page says what is missing instead of failing.

## How it fits together

```
            your tailnet (Tailscale, WireGuard encrypted)
  ┌──────────────────────────────────────────────────────────────┐
  │                                                              │
  │   laptop                 desktop               server        │
  │  ┌─────────────┐       ┌─────────────┐      ┌──────────────┐ │
  │  │ mirai-agent │       │ mirai-agent │      │ mirai-agent  │ │
  │  │ :7070 Rust  │       │ :7070 Rust  │      │ mirai hub    │ │
  │  └──────▲──────┘       └──────▲──────┘      │ :3131 Bun    │ │
  │         │                     │             │ SQLite       │ │
  │         └──── hub polls ──────┴─────────────┤              │ │
  │                                             └──────▲───────┘ │
  │                          browser / phone PWA ──────┘         │
  └──────────────────────────────────────────────────────────────┘
```

- **hub** (`frontend/`): a Bun server and React app. It finds machines with `tailscale status`, polls each agent, keeps history in SQLite and talks to GitHub, Linear and OpenRouter. Pick one always-on machine for it.
- **agent** (`agent/`): a small Rust binary on every machine you want to see. It listens only on the machine's Tailscale address and answers only the hub.
- **highlighter** (`code/`): an optional Rust binary the hub uses to colour PR diffs.

## Tour

Every screenshot below comes from a demo fleet of six Docker containers with invented data; nothing in them is anyone's real work.

### machines

Live CPU, memory, disks and network paths for every machine on the tailnet, with events and history.

![fleet overview](docs/screenshots/machines.webp)

Open a machine for its cores, memory, disks, health, services and processes. Processes can be stopped from here.

![one machine](docs/screenshots/machine-detail.webp)

### projects

What is running where: git worktrees with their dev servers, grouped by project across machines. Three views of the same data.

![projects stack](docs/screenshots/projects.webp)

| treemap | sky |
| --- | --- |
| ![projects treemap](docs/screenshots/projects-treemap.webp) | ![projects sky](docs/screenshots/projects-sky.webp) |

### tasks

Obsidian daily-note tasks, Linear issues and GitHub issues on one board, with a priority ranking that weighs what unblocks the most.

![all tasks](docs/screenshots/tasks-all.webp)

| daily notes | Linear | GitHub |
| --- | --- | --- |
| ![daily-note tasks](docs/screenshots/tasks-local.webp) | ![Linear board](docs/screenshots/tasks-linear.webp) | ![GitHub board](docs/screenshots/tasks-github.webp) |

### ship

Your open pull requests sorted by how close they are to merging, the ones waiting on your review, and a merge-readiness ranking.

![pull requests](docs/screenshots/ship.webp)

![pull request preview](docs/screenshots/ship-preview.webp)

### content

A read-later queue for articles, papers, posts and videos, with folders, a time budget and a "worth your time" ranking.

![content queue](docs/screenshots/content.webp)

| reader | video with local transcript |
| --- | --- |
| ![article reader](docs/screenshots/content-reader.webp) | ![video and transcript](docs/screenshots/content-watch.webp) |

### notes

Your Obsidian vault in the browser: a link graph, and a live-preview editor with backlinks.

| graph | note |
| --- | --- |
| ![notes graph](docs/screenshots/notes-graph.webp) | ![a note](docs/screenshots/notes-note.webp) |

### stats

Claude Code and Codex usage per machine: cost, tokens, models and how much of your plan limits is left.

![AI usage stats](docs/screenshots/stats.webp)

### mirAI and the palette

Ask about anything on screen. mirAI reads the same data the pages show and links its answers back into Mirai. `⌘K` searches pages, notes and content, or hands the question to mirAI.

![mirAI side panel](docs/screenshots/mirai.webp)

![command palette](docs/screenshots/palette.webp)

### phone

The same app as an installable PWA.

![mobile views](docs/screenshots/mobile.webp)

## Set up with an AI coding agent

Paste this into Claude Code, Codex or any agent that can run shell commands on the machine you are setting up. It installs what is missing, builds everything, installs the background services and finishes with `bun run doctor` as proof.

````text
Set up Mirai (https://github.com/FreeRikato/mirai) on this machine, end to end, following its README exactly.

1. Detect the OS. macOS and Linux are supported natively. On Windows, stop and tell me to open a WSL2 Ubuntu shell (README "Windows") and run you again inside it.
2. Ask me one question: is this machine the hub, or only an agent reporting to a hub that already exists? If agent only, ask for the hub's Tailscale machine name.
3. Install whatever is missing from the README "Prerequisites" for this OS, using the commands given there. Ask before any sudo command. Installers add Bun and Rust to PATH only for new terminals, so afterwards run: export PATH="$HOME/.bun/bin:$HOME/.cargo/bin:$PATH"
4. If `tailscale status` says Tailscale is not connected: on Linux run `sudo tailscale up`, on macOS open the Tailscale app. Show me the sign-in link and wait until I have signed in, then confirm with `tailscale status`. On Linux also run once: sudo tailscale set --operator=$USER
5. Clone the repo into ~/src/mirai if it is not already here (not ~/mirai, which deploy/install-hub.sh uses for remote deploys), then in ~/src/mirai/frontend: `bun install`, then `bun run build:agent`.
6. Install the agent as a background service: `MIRAI_AGENT_HUB=<hub machine name> deploy/install-agent.sh local`. On the hub machine the hub name is this machine's own Tailscale name: tailscale status --json | jq -r '.Self.DNSName | split(".")[0]'
7. Hub machine only: `cp .env.example .env && chmod 600 .env`. Then tell me which optional integrations exist (README "Configure") and let me paste any keys into frontend/.env myself in my editor. Never ask me to paste a key into this chat, never print .env, never echo a key in a command, and never commit .env.
8. Hub machine only: install the hub as a background service with `deploy/install-hub.sh local`. Do not run the hub in your own shell, it would stop when this session ends. If the script prints a tailscale serve hint, tell me what to turn on in the Tailscale admin console, and after I confirm, run the command it printed.
9. Run `bun run doctor` in frontend/. On an agent-only machine run `bun run doctor --hub https://<hub machine>.<tailnet>.ts.net` (the tailnet name is in `tailscale status --json | jq -r .MagicDNSSuffix`). Fix every FAIL using the hint printed next to it and run it again until there are no FAILs. "off" lines are optional integrations and are fine. A new machine can take up to 30 seconds to show up on the hub.
10. Finish by showing me the final doctor output verbatim and the URL where I can open the dashboard.
````

## Prerequisites

| | macOS | Debian / Ubuntu / WSL2 | Fedora | Arch |
| --- | --- | --- | --- | --- |
| base tools | `xcode-select --install` (gives git and a C compiler; jq ships with macOS 15+, else `brew install jq`) | `sudo apt install -y build-essential git jq unzip curl` | `sudo dnf install -y gcc git jq unzip curl` | `sudo pacman -S --needed base-devel git jq unzip curl` |
| Bun 1.3+ | `curl -fsSL https://bun.sh/install \| bash` | same | same | same |
| Rust | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh -s -- -y` | same | same | same |
| Tailscale | the [Tailscale app](https://tailscale.com/download/mac), then **Settings → Install CLI** | `curl -fsSL https://tailscale.com/install.sh \| sh` | same | same |

Open a new terminal after installing Bun and Rust so they are on your PATH. On Linux, sign in with `sudo tailscale up` and then run `sudo tailscale set --operator=$USER` once, so the hub can publish itself with `tailscale serve` without sudo. The services use launchd on macOS and systemd user services on Linux.

Optional: `gh` (GitHub token without copying one), `yt-dlp` (YouTube playlists), `uv` and `ffmpeg` (local video transcripts), `mise` (only for deploying the hub to another machine).

### Windows

The agent reads `/proc`, `ps` and systemd, so it does not run on native Windows. Run Mirai inside WSL2 and follow the Debian / Ubuntu column:

```powershell
wsl --install -d Ubuntu
```

Open Ubuntu and make sure `/etc/wsl.conf` contains `[boot]` and `systemd=true` (new installs already do; run `wsl --shutdown` in PowerShell after changing it). Install Tailscale inside Ubuntu as above. The WSL2 instance joins your tailnet as its own machine, and its numbers describe the WSL2 VM, not the whole Windows host. WSL2 stops when no Windows terminal uses it for a while, so a Windows machine makes a better agent than hub.

## Manual setup

Everything below runs in `frontend/`.

### 1. Every machine: build and start the agent

```sh
git clone https://github.com/FreeRikato/mirai ~/src/mirai
cd ~/src/mirai/frontend
bun install
bun run build:agent
MIRAI_AGENT_HUB=<hub machine name> deploy/install-agent.sh local
```

`<hub machine name>` is the first label of the hub's Tailscale name (`homeserver` for `homeserver.tail1234.ts.net`). On the hub itself, use its own name. The agent runs as a launchd agent on macOS (`~/Library/LaunchAgents/dev.mirai.agent.plist`, log in `~/Library/Logs/mirai-agent.log`) and as a systemd user service on Linux (`journalctl --user -u mirai-agent`).

From one machine you can also push a Linux agent to others over ssh: `MIRAI_AGENT_HUB=<hub> deploy/install-agent.sh <ssh host> [<ssh host>...]`. From a Mac, set `MIRAI_AGENT_BUILD_HOST=<linux ssh host>` before `bun run build:agent` so it also builds the Linux binary there.

### 2. The hub machine: configure and start

```sh
cp .env.example .env
chmod 600 .env
deploy/install-hub.sh local
```

This builds the app and installs the hub as a background service (launchd on macOS, log in `~/Library/Logs/mirai-hub.log`; systemd on Linux, `journalctl --user -u mirai-hub`). It then publishes the hub to your tailnet with `tailscale serve`, which needs MagicDNS and HTTPS Certificates turned on in the [Tailscale admin console](https://login.tailscale.com/admin/dns). Run it again after pulling updates or changing `.env`.

Open http://127.0.0.1:3131 on the hub, or `https://<hub machine>.<tailnet>.ts.net` from any of your devices, where you can also install it as an app.

To just try it without a service, `bun run start` runs the hub in the foreground.

### 3. Prove it works

```sh
bun run doctor
```

```
mirai doctor
  ok    bun           1.3.14
  ok    dependencies  installed
  ok    .env          private and ignored by git
  ok    settings      valid
  ok    tailscale     this machine is homeserver
  ok    rust          cargo 1.90.0
  ok    agent build   ~/src/mirai/frontend/bin/mirai-agent-linux-x64
  ok    agent         running on homeserver:7070
  ok    hub           3 machines on the tailnet, 3 reporting; homeserver at 4% cpu
  ok    github        signed in as octocat
  off   linear        LINEAR_API_KEY not set (Linear board)
  ...
```

The `hub` line is the end-to-end proof: the hub found this machine on the tailnet, reached its agent and received live metrics. Keys are checked with a harmless read-only call (who am I, list models) and are never printed, so the output is safe to paste into an issue. The command exits non-zero while anything says FAIL.

On a machine that only runs an agent, point it at the hub: `bun run doctor --hub https://<hub>.<tailnet>.ts.net`.

### Deploy the hub to another machine

`deploy/install-hub.sh <ssh host>` copies this tree to `~/mirai` on a Linux host with systemd and `mise`, builds it there, installs the `mirai-hub` user service, downloads `px0` for PR review and runs `tailscale serve`. Settings on that host live in `~/.config/mirai/hub.env`, which the script creates with mode 600 and never overwrites. Run it again to deploy an update. To check it, run the doctor there with those settings: `bun --env-file="$HOME/.config/mirai/hub.env" run doctor`.

## Configure

`frontend/.env.example` lists every hub setting with its default and a line about what it does. `src/hub/config.ts` validates them at startup, and a test keeps the two in sync. The ones you are most likely to set:

| Setting | Turns on |
| --- | --- |
| `MIRAI_VAULT_DIR` | tasks from daily notes, and the notes page. Needs Obsidian's Daily notes core plugin enabled in that vault |
| `GITHUB_TOKEN` | GitHub issues and the ship page. Leave blank to use `gh auth token`. A fine-grained token with read access to issues, pull requests and contents is enough |
| `MIRAI_SHIP_ORG` | the ship page, for that GitHub org |
| `LINEAR_API_KEY` | the Linear board (Linear → Settings → API → personal API key) |
| `OPENROUTER_API_KEY` | priority ranking of tasks |
| `OPENAI_API_KEY` | the mirAI assistant |
| `MIRAI_OWNER` | the name mirAI calls you |
| `MIRAI_ASR_BIN` | local YouTube transcripts; `deploy/asr/setup.sh` installs the model and sets it |

The agent reads its own `MIRAI_AGENT_*` variables (port, hub, projects root, cache times) from its service definition; see `agent/src/config.rs`. By default it scans `~/Developer` for git worktrees.

## Security model

Read this before you run it.

- **Your tailnet is the only login.** The hub has no accounts. Anyone who can reach it on your tailnet can use every page, including killing processes on your machines. Keep it tailnet-only (`tailscale serve`, never `tailscale funnel`), and if you share your tailnet with others, restrict port 443 and 3131 on the hub to yourself with [Tailscale ACLs](https://tailscale.com/kb/1018/acls).
- **mirAI has a shell.** The assistant runs with full shell and file access as the hub's user, the same as a coding agent. It is off until you set `OPENAI_API_KEY`. Do not run the hub as root.
- **Agents answer only the hub.** Each agent listens on its Tailscale address and rejects every request that does not come from the hub's Tailscale IP.
- **Agents read your AI usage.** For the stats page each agent reads Claude Code and Codex session logs and uses their local logins to fetch plan limits. Nothing leaves your tailnet except those limit requests to Anthropic and OpenAI.
- **Secrets stay in one place.** Keys live only in `frontend/.env` (dev) or `~/.config/mirai/hub.env` (deployed), both ignored by git and mode 600. `deploy/install-hub.sh` never copies `.env`. The doctor never prints them.

## Develop

```sh
bun run dev          # hub with watch mode on :3131
bun test src         # unit tests
bunx tsc --noEmit    # types
bun run e2e          # Playwright, against a production build it starts on :3232
cd ../agent && cargo test
```

The code carries no comments by design: intent lives in names and types, and anything that needs explaining goes in the commit message or `docs/`. `CONTEXT.md` is the glossary and `docs/adr/` holds design decisions.

## License

[MIT](LICENSE)
