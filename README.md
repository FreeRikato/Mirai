# Mirai

A personal dashboard for people who work across several machines. One hub shows every computer on your Tailscale network, your tasks, your pull requests, your saved reading and videos, your Obsidian notes and your AI coding spend, with an assistant (mirAI) that can answer questions about all of it.

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

## Set up with an AI coding agent

Paste this into Claude Code, Codex or any agent that can run shell commands on the machine you are setting up. It installs what is missing, builds everything, starts the services and finishes with `bun run doctor` as proof.

````text
Set up Mirai (https://github.com/FreeRikato/mirai) on this machine, end to end, following its README exactly.

1. Detect the OS. macOS and Linux are supported natively. On Windows, stop and tell me to open a WSL2 Ubuntu shell (README "Windows") and run you again inside it.
2. Ask me one question: is this machine the hub, or only an agent reporting to a hub that already exists? If agent only, ask for the hub's Tailscale machine name.
3. Install whatever is missing from the README "Prerequisites" for this OS (git, Bun, Rust, a C toolchain, Tailscale, jq). Use the official installers named there. Ask before any sudo command.
4. If Tailscale is not connected, run `tailscale up` (or on macOS open the Tailscale app) and wait for me to sign in in the browser. Confirm with `tailscale status`.
5. Clone the repo into ~/src/mirai if it is not already here (not ~/mirai, which is where deploy/install-hub.sh deploys to), then in frontend/: `bun install`, then `bun run build:agent`.
6. Install the agent as a background service: `MIRAI_AGENT_HUB=<hub machine name> deploy/install-agent.sh local`. On the hub machine the hub name is this machine's own Tailscale name (`tailscale status --json | jq -r '.Self.DNSName | split(".")[0]'`).
7. Hub machine only: `cp .env.example .env && chmod 600 .env`. Then tell me which optional integrations exist (README "Configure") and let me paste any keys into frontend/.env myself in my editor. Never ask me to paste a key into this chat, never print .env, never echo a key in a command, and never commit .env.
8. Hub machine only: start the hub. On Linux with systemd prefer the service from README "Keep the hub running"; otherwise run `bun run start` in a tmux or screen session that survives this chat.
9. Run `bun run doctor` in frontend/ (agent-only machines: `bun run doctor --hub https://<hub machine>.<tailnet>.ts.net`, or `http://<hub machine>:3131` if the hub is not behind `tailscale serve`). Fix every FAIL using the hint printed next to it and run it again until there are no FAILs. "off" lines are optional integrations and are fine.
10. Finish by showing me the final doctor output verbatim and the URL where I can open the dashboard.
````

## Prerequisites

| | macOS | Linux | Windows |
| --- | --- | --- | --- |
| Bun 1.3+ | `curl -fsSL https://bun.sh/install \| bash` | same | inside WSL2 |
| Rust | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` | same | inside WSL2 |
| C toolchain | `xcode-select --install` | `build-essential` / `base-devel` | inside WSL2 |
| Tailscale | the Tailscale app, then **Settings → Install CLI** | `curl -fsSL https://tailscale.com/install.sh \| sh` | inside WSL2, see below |
| git, jq | `brew install git jq` | your package manager | inside WSL2 |
| service manager | launchd (built in) | systemd user services | systemd in WSL2 |

Optional: `gh` (GitHub token without copying one), `yt-dlp` (YouTube playlists), `uv` and `ffmpeg` (local video transcripts), `mise` (only for `deploy/install-hub.sh`).

### Windows

The agent reads `/proc`, `ps` and systemd, so it does not run on native Windows. Run Mirai inside WSL2, which behaves like the Linux column above:

```powershell
wsl --install -d Ubuntu
```

Open Ubuntu, make sure `/etc/wsl.conf` contains `[boot]` and `systemd=true` (new installs already do; run `wsl --shutdown` after changing it), then install Tailscale inside Ubuntu and run `sudo tailscale up`. The WSL2 instance joins your tailnet as its own machine. Its numbers describe the WSL2 VM, not the whole Windows host. From here on follow the Linux steps.

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
bun run start
```

Open http://127.0.0.1:3131. To reach it from your other devices over HTTPS, and to install it as a PWA on your phone:

```sh
tailscale serve --bg --https=443 http://127.0.0.1:3131
```

It is then at `https://<hub machine>.<tailnet>.ts.net`.

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
  ok    agent         running on homeserver, answers only its hub
  ok    hub           3 machines on the tailnet, 3 reporting; homeserver at 4% cpu
  ok    github        signed in as octocat
  off   linear        LINEAR_API_KEY not set (Linear board)
  ...
```

The `hub` line is the end-to-end proof: the hub found this machine on the tailnet, reached its agent and received live metrics. Keys are checked with a harmless read-only call (who am I, list models) and are never printed, so the output is safe to paste into an issue. The command exits non-zero while anything says FAIL.

On a machine that only runs an agent, point it at the hub: `bun run doctor --hub https://<hub>.<tailnet>.ts.net`. On a hub that reads its settings from `~/.config/mirai/hub.env`, load them first: `bun --env-file="$HOME/.config/mirai/hub.env" run doctor`.

### Keep the hub running

On a Linux machine with systemd, `deploy/install-hub.sh <ssh host>` copies this tree to `~/mirai` on that host, builds it with `mise`, installs a `mirai-hub` user service, downloads `px0` for PR review and runs `tailscale serve`. Settings on that host live in `~/.config/mirai/hub.env`, which the script creates with mode 600 and never overwrites. Run it again to deploy an update. It works for the machine you are on too (`deploy/install-hub.sh localhost`, needs sshd), as long as your clone is not `~/mirai` itself: the deploy replaces that directory.

On macOS, keep `bun run start` running in tmux, or use an always-on Linux box for the hub and only the agent on the Mac.

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
