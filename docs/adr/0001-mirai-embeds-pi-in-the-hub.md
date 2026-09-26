# mirAI embeds pi in the hub through its SDK

mirAI runs pi (`@earendil-works/pi-coding-agent`) in-process inside the hub with `createAgentSession`, not as a `pi --mode rpc` subprocess per Thread. mirAI's own tools (machines, tasks, ship and stats) read snapshots the hub already holds in memory, so in-process tools are plain typed functions over those stores, while a subprocess would need a pi extension calling back into the hub's HTTP API for every read. Everything on disk (content, notes, the llm-wiki, the hub database) and every machine's mirai-agent is reached through pi's own shell and file tools. pi's resource discovery is switched off so the hub machine's personal `~/.pi` setup never leaks into mirAI.

## Considered Options

- **RPC subprocess per Thread, managed like px0 sessions**: better crash isolation and could run on any host over ssh, but needs a hub bridge for every tool and costs a process per Thread on a memory-tight hub. Kept as the route for a future "run on this host" tool, not for reading Mirai's own data.

## Consequences

- A hub deploy or restart cuts off an answer in flight; the Thread itself survives because pi persists it as JSONL.
- pi is a hub dependency pinned in `package.json`, so pi upgrades ship with hub deploys.
- mirAI gets pi's full built-in toolset (read, bash, edit, write, grep, find, ls) with no sandbox and no draft step for wiki writes; bash runs with the hub's secret-named environment variables removed and a 120 s default timeout, running as the hub user (2026-09-26, superseding v1's read-only rule). Mirai is single-user, and letting the model and harness choose their own `rg`/`fd`/`sed`/`awk` searches beats a narrow tool per data source. The accepted risk: text mirAI reads from others (PR bodies, Linear issues, saved articles) can prompt-inject commands that run with access to `~/.ssh`, `hub.env` and the docker group. A bwrap sandbox (read-only wiki and content, no network, no `$HOME`) was considered and declined.
