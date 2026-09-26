import { afterEach, expect, test } from "bun:test";
import { chmod, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPx0, Px0Error, type Px0 } from "./sessions";

const FAKE_PX0 = `#!/usr/bin/env bun
const arg = flag => process.argv[process.argv.indexOf(flag) + 1];
if (process.env.FAKE_PX0_FAIL) {
  console.error("git fetch PR head: repository not found");
  process.exit(1);
}
const base = arg("-base-path");
process.on("SIGTERM", async () => {
  await Bun.sleep(300);
  await Bun.write(process.cwd() + "/cleaned-" + arg("-port"), "");
  process.exit(0);
});
Bun.serve({
  hostname: "127.0.0.1",
  port: Number(arg("-port")),
  idleTimeout: 0,
  async fetch(req) {
    const path = new URL(req.url).pathname;
    if (path === base + "api/meta") return Response.json({ pr: process.argv.at(-1), cwd: process.cwd(), gzip: req.headers.get("accept-encoding") });
    if (path === base + "api/stream") return new Response(new ReadableStream({ start: c => c.enqueue(new TextEncoder().encode("data: hi\\n\\n")) }), { headers: { "content-type": "text/event-stream" } });
    if (req.method === "POST" && URL.parse(req.headers.get("origin") ?? "")?.host !== req.headers.get("host")) return new Response("request did not come from px0", { status: 403 });
    if (req.method === "POST") return new Response("posted " + (await req.text()));
    return new Response("missing", { status: 404 });
  },
});
`;

const dir = await mkdtemp(join(tmpdir(), "mirai-px0-"));
const bin = join(dir, "px0");
await writeFile(bin, FAKE_PX0);
await chmod(bin, 0o755);

const opened: Px0[] = [];
const servers: ReturnType<typeof Bun.serve>[] = [];
afterEach(async () => {
  await Promise.all(opened.splice(0).map(px0 => px0.shutdown()));
  for (const s of servers.splice(0)) void s.stop(true);
});

function setup(opts: { max?: number; fail?: boolean } = {}) {
  const px0 = createPx0({ bin, idleMs: 60_000, max: opts.max ?? 4, readyTimeoutMs: 10_000, workspace: async () => dir, env: async (): Promise<Record<string, string>> => (opts.fail ? { FAKE_PX0_FAIL: "1" } : {}) });
  opened.push(px0);
  const hub = Bun.serve({ port: 0, routes: { "/px0/*": (req, server) => px0.proxy(req, server) } });
  servers.push(hub);
  return { px0, hub: `http://127.0.0.1:${hub.port}` };
}

test("opening a pull request starts px0 on it under /px0/<repo>-<number>/ and the hub proxies to it", async () => {
  const { px0, hub } = setup();
  const s = await px0.open({ repo: "databrainhq/frontend-mono", number: 8371 });
  expect(s.path).toBe("/px0/frontend-mono-8371/");
  const meta = await (await fetch(`${hub}${s.path}api/meta`, { headers: { "accept-encoding": "gzip" } })).json();
  expect(meta).toEqual({ pr: "https://github.com/databrainhq/frontend-mono/pull/8371", cwd: expect.stringContaining("mirai-px0-"), gzip: "identity" });
  expect(await px0.open({ repo: "databrainhq/frontend-mono", number: 8371 })).toBe(s);
});

test("a px0 that exits before it is ready fails with its last line of output and is not listed", async () => {
  const { px0 } = setup({ fail: true });
  const attempt = px0.open({ repo: "databrainhq/backend", number: 1 });
  expect(attempt).rejects.toThrow(new Px0Error("git fetch PR head: repository not found"));
  await attempt.catch(() => null);
  expect(await px0.list()).toEqual([]);
});

test("opening past the limit stops the least recently used instance", async () => {
  const { px0 } = setup({ max: 2 });
  await px0.open({ repo: "o/a", number: 1 });
  await Bun.sleep(5);
  await px0.open({ repo: "o/b", number: 2 });
  await Bun.sleep(5);
  await px0.open({ repo: "o/a", number: 1 });
  await px0.open({ repo: "o/c", number: 3 });
  expect((await px0.list()).map(s => s.id).sort()).toEqual(["a-1", "c-3"]);
});

test("idle instances are stopped unless a tab still has px0 open", async () => {
  const { px0, hub } = setup();
  const watched = await px0.open({ repo: "o/a", number: 1 });
  await px0.open({ repo: "o/b", number: 2 });
  const stream = await fetch(`${hub}${watched.path}api/stream`, { headers: { accept: "text/event-stream" } });
  const reader = stream.body?.getReader();
  await reader?.read();
  px0.reap(Date.now() + 120_000);
  expect((await px0.list()).map(s => [s.id, s.viewing])).toEqual([["a-1", true]]);
  await reader?.cancel();
});

test("the proxy refuses writes from another site and forwards same-origin ones", async () => {
  const { px0, hub } = setup();
  const s = await px0.open({ repo: "o/a", number: 1 });
  const cross = await fetch(`${hub}${s.path}api/git/commit`, { method: "POST", headers: { origin: "https://evil.example" }, body: "x" });
  expect(cross.status).toBe(403);
  const same = await fetch(`${hub}${s.path}api/git/commit`, { method: "POST", headers: { origin: hub }, body: "msg" });
  expect(await same.text()).toBe("posted msg");
  expect((await fetch(`${hub}/px0/gone-9/api/meta`)).status).toBe(404);
});

test("shutting the hub down lets every px0 finish removing its checkout before the hub exits", async () => {
  const { px0 } = setup();
  await px0.open({ repo: "o/a", number: 1 });
  await px0.open({ repo: "o/b", number: 2 });
  const before = (await readdir(dir)).filter(f => f.startsWith("cleaned-")).length;
  await px0.shutdown();
  expect((await readdir(dir)).filter(f => f.startsWith("cleaned-")).length - before).toBe(2);
  expect(await px0.list()).toEqual([]);
});
