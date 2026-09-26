import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { AgentTailnetSchema, HostDetailSchema, MetricsSchema } from "@/shared/schema";
import { ProjectsSnapshotSchema } from "@/shared/projects";
import { AgentLimitsSchema, AgentUsageSchema } from "@/shared/usage";

const BINARY = join(import.meta.dir, "../../../agent/target/release/mirai-agent");
const built = await Bun.file(BINARY).exists();
const PORT = 17_070 + Math.floor(Math.random() * 1000);
const base = `http://127.0.0.1:${PORT}`;

let agent: Bun.Subprocess | null = null;
let home = "";

beforeAll(async () => {
  if (!built) return;
  home = await mkdtemp(join(tmpdir(), "mirai-agent-contract-"));
  const repo = join(home, "Developer", "app");
  await Bun.$`mkdir -p ${repo} && git -C ${repo} init -q -b main && git -C ${repo} -c user.name=t -c user.email=t@t commit -q --allow-empty -m init`.quiet();
  agent = Bun.spawn([BINARY], {
    env: {
      HOME: home,
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      TAILSCALE_BIN: "/usr/bin/false",
      MIRAI_AGENT_HOST: "127.0.0.1",
      MIRAI_AGENT_PORT: String(PORT),
      MIRAI_AGENT_CLAUDE_DIR: join(home, "claude"),
      MIRAI_AGENT_CODEX_DIR: join(home, "codex"),
      MIRAI_AGENT_PROJECTS_MS: "200",
    },
    stdout: "ignore",
    stderr: "ignore",
  });
  for (let i = 0; i < 50; i++) {
    if (await fetch(`${base}/health`).then(r => r.ok, () => false)) return;
    await Bun.sleep(100);
  }
  throw new Error(`the rust agent did not come up on ${base}`);
});

afterAll(async () => {
  agent?.kill();
  if (home) await rm(home, { recursive: true, force: true });
});

const get = async (path: string) => (await fetch(`${base}${path}`)).json();

const post = (path: string, body: unknown, headers: Record<string, string> = { "content-type": "application/json" }) =>
  fetch(`${base}${path}`, { method: "POST", headers, body: JSON.stringify(body) });

test.skipIf(!built)("every read route answers in the exact shape the hub parses", async () => {
  expect(z.object({ ok: z.literal(true), version: z.string() }).parse(await get("/health")).version).toMatch(/^\d+\.\d+\.\d+$/);
  const metrics = MetricsSchema.parse(await get("/metrics"));
  expect(metrics.info.threads).toBeGreaterThan(0);
  expect(metrics.cpu.cores).toHaveLength(metrics.info.threads);
  const detail = HostDetailSchema.parse(await get("/detail"));
  expect(detail.processes.length).toBeGreaterThan(0);
  expect(detail.processes.filter(p => p.killable).every(p => p.pid !== agent?.pid && p.pid > 1)).toBe(true);
  AgentTailnetSchema.parse(await get("/tailnet"));
  expect(AgentUsageSchema.parse(await get("/usage")).rows).toEqual([]);
  expect(AgentLimitsSchema.parse(await get("/limits")).map(l => [l.provider, l.ok])).toEqual([
    ["claude", false],
    ["codex", false],
  ]);
});

test.skipIf(!built)("projects names the worktrees under ~/Developer and the folder each listening process runs from", async () => {
  const repo = join(home, "Developer", "app");
  const server = Bun.spawn(["bun", "-e", "Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response('ok') }); console.log('up')"], { cwd: repo, stdout: "pipe" });
  await server.stdout.getReader().read();
  try {
    let snap = ProjectsSnapshotSchema.parse(await get("/projects"));
    for (let i = 0; i < 150 && !snap.listeners.some(l => l.pid === server.pid); i++) {
      await Bun.sleep(100);
      snap = ProjectsSnapshotSchema.parse(await get("/projects"));
    }
    expect(snap.worktrees.map(w => [w.path.endsWith("/Developer/app"), w.branch])).toEqual([[true, "main"]]);
    const mine = snap.listeners.find(l => l.pid === server.pid);
    expect(mine?.cwd?.endsWith("/Developer/app")).toBe(true);
    expect(mine?.memBytes).toBeGreaterThan(0);
  } finally {
    server.kill();
  }
});

test.skipIf(!built)("kill signals a process the user owns and refuses anything that did not come from the hub", async () => {
  const victim = Bun.spawn(["sleep", "60"]);
  expect((await post("/kill", { pid: victim.pid, name: "sleep", signal: "SIGTERM" }, { "content-type": "application/json", origin: "https://evil.example" })).status).toBe(403);
  expect((await post("/kill", { pid: victim.pid }, { "content-type": "application/json" })).status).toBe(400);
  const res = await post("/kill", { pid: victim.pid, name: "sleep", signal: "SIGTERM" });
  expect(await res.json()).toEqual({ pid: victim.pid, name: "sleep", signal: "SIGTERM" });
  expect(await victim.exited).not.toBe(0);
});

test.skipIf(!built)("open rejects anything but an http(s) url and unknown routes are 404", async () => {
  expect((await post("/open", { url: "file:///etc/passwd" })).status).toBe(400);
  expect((await fetch(`${base}/kill`)).status).toBe(404);
  expect((await fetch(`${base}/nope`)).status).toBe(404);
});
