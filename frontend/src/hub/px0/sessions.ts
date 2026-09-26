import type { Server, Subprocess } from "bun";
import { closeSync, openSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { px0Id, type Px0Open, type Px0Session } from "@/shared/px0";

export class Px0Error extends Error {}

type Deps = {
  bin: string;
  idleMs: number;
  max: number;
  readyTimeoutMs: number;
  workspace: (repo: string) => Promise<string>;
  env: () => Promise<Record<string, string>>;
};

type Session = {
  id: string;
  repo: string;
  number: number;
  path: string;
  port: number;
  proc: Subprocess;
  startedAt: number;
  lastUsedAt: number;
  streams: number;
};

type Starting = { repo: string; number: number; startedAt: number; done: Promise<Session> };

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const probe = createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() => (typeof address === "object" && address ? resolve(address.port) : reject(new Px0Error("no free port for px0"))));
    });
  });

const lastLine = (text: string) =>
  text
    .split("\n")
    .map(l => l.trim())
    .filter(Boolean)
    .at(-1);

const crossSite = (req: Request) => {
  const origin = req.headers.get("origin");
  return origin !== null && URL.parse(origin)?.host !== new URL(req.url).host;
};

async function residentMb(pids: readonly number[]): Promise<Map<number, number>> {
  if (pids.length === 0) return new Map();
  const out = await Bun.$`ps -o pid=,rss= -p ${pids.join(",")}`.quiet().nothrow();
  const rows = out.stdout
    .toString()
    .trim()
    .split("\n")
    .map(line => line.trim().split(/\s+/).map(Number));
  return new Map(rows.flatMap(([pid, kb]) => (pid && kb ? [[pid, Math.round(kb / 1024)] as const] : [])));
}

export function createPx0(deps: Deps) {
  const running = new Map<string, Session>();
  const starting = new Map<string, Starting>();

  const stop = (id: string): boolean => {
    const s = running.get(id);
    if (!s) return false;
    running.delete(id);
    s.proc.kill("SIGTERM");
    return true;
  };

  const makeRoom = () => {
    const byAge = [...running.values()].sort((a, b) => Number(a.streams > 0) - Number(b.streams > 0) || a.lastUsedAt - b.lastUsedAt);
    for (const s of byAge) {
      if (running.size + starting.size < deps.max) return;
      stop(s.id);
    }
  };

  const waitReady = async (s: Session, log: string) => {
    let exited = false;
    void s.proc.exited.then(() => (exited = true));
    const deadline = Date.now() + deps.readyTimeoutMs;
    while (!exited) {
      if (Date.now() > deadline) throw new Px0Error(`px0 did not start within ${Math.round(deps.readyTimeoutMs / 1000)}s`);
      if (await fetch(`http://127.0.0.1:${s.port}${s.path}api/meta`).then(r => r.ok, () => false)) return;
      await Bun.sleep(200);
    }
    throw new Px0Error(lastLine(await Bun.file(log).text().catch(() => "")) ?? `px0 exited with code ${s.proc.exitCode}`);
  };

  const launch = async (id: string, { repo, number }: Px0Open): Promise<Session> => {
    const [cwd, port, env] = await Promise.all([deps.workspace(repo), freePort(), deps.env()]);
    const path = `/px0/${id}/`;
    const args = ["-no-open", "-no-telemetry", "-no-lsp", "-no-color", "-host", "127.0.0.1", "-port", String(port), "-base-path", path];
    const log = join(tmpdir(), `mirai-px0-${id}.log`);
    const out = openSync(log, "w");
    const proc = Bun.spawn([deps.bin, ...args, `https://github.com/${repo}/pull/${number}`], { cwd, env: { ...process.env, ...env }, stdin: "ignore", stdout: out, stderr: out });
    closeSync(out);
    const s: Session = { id, repo, number, path, port, proc, startedAt: Date.now(), lastUsedAt: Date.now(), streams: 0 };
    try {
      await waitReady(s, log);
    } catch (err: unknown) {
      proc.kill("SIGTERM");
      throw err;
    }
    void proc.exited.then(() => running.get(id) === s && running.delete(id));
    running.set(id, s);
    return s;
  };

  const open = (req: Px0Open): Promise<Session> => {
    const id = px0Id(req.repo, req.number);
    const live = running.get(id);
    if (live) {
      live.lastUsedAt = Date.now();
      return Promise.resolve(live);
    }
    const pending = starting.get(id);
    if (pending) return pending.done;
    makeRoom();
    const done = launch(id, req).finally(() => starting.delete(id));
    starting.set(id, { repo: req.repo, number: req.number, startedAt: Date.now(), done });
    return done;
  };

  const list = async (): Promise<Px0Session[]> => {
    const live = [...running.values()];
    const rss = await residentMb(live.map(s => s.proc.pid));
    const ready = live.map(s => ({ id: s.id, repo: s.repo, number: s.number, path: s.path, ready: true, viewing: s.streams > 0, startedAt: s.startedAt, lastUsedAt: s.lastUsedAt, rssMb: rss.get(s.proc.pid) ?? null }));
    const pending = [...starting].map(([id, p]) => ({ id, repo: p.repo, number: p.number, path: `/px0/${id}/`, ready: false, viewing: false, startedAt: p.startedAt, lastUsedAt: p.startedAt, rssMb: null }));
    return [...ready, ...pending].sort((a, b) => b.lastUsedAt - a.lastUsedAt);
  };

  const reap = (at = Date.now()) => {
    for (const s of [...running.values()]) if (s.streams === 0 && at - s.lastUsedAt > deps.idleMs) stop(s.id);
  };

  const proxy = async (req: Request, server: Server<unknown>): Promise<Response> => {
    const url = new URL(req.url);
    const s = running.get(url.pathname.split("/")[2] ?? "");
    if (!s) return new Response("this px0 session has ended, open it again from mirai", { status: 404 });
    if (req.method !== "GET" && req.method !== "HEAD" && crossSite(req)) return new Response("px0 writes need a same-origin request", { status: 403 });
    const streaming = req.headers.get("accept") === "text/event-stream";
    if (streaming) server.timeout(req, 0);
    s.lastUsedAt = Date.now();
    const headers = new Headers(req.headers);
    headers.set("accept-encoding", "identity");
    headers.delete("host");
    if (headers.has("origin")) headers.set("origin", `http://127.0.0.1:${s.port}`);
    const hasBody = req.method !== "GET" && req.method !== "HEAD";
    const upstream = await fetch(`http://127.0.0.1:${s.port}${url.pathname}${url.search}`, {
      method: req.method,
      headers,
      body: hasBody ? await req.arrayBuffer() : undefined,
      redirect: "manual",
      signal: req.signal,
    }).catch(() => null);
    if (!upstream) return new Response("px0 is not answering", { status: 502 });
    if (!streaming || !upstream.body) return new Response(upstream.body, upstream);
    s.streams++;
    let open = true;
    const end = () => {
      if (!open) return;
      open = false;
      s.streams--;
      s.lastUsedAt = Date.now();
    };
    req.signal.addEventListener("abort", end);
    return new Response(upstream.body.pipeThrough(new TransformStream({ flush: end })), upstream);
  };

  const shutdown = async (graceMs = 5_000) => {
    const exits = [...running.values()].map(s => s.proc.exited);
    for (const id of [...running.keys()]) stop(id);
    await Promise.race([Promise.all(exits), Bun.sleep(graceMs)]);
  };

  return { open, list, stop, reap, proxy, shutdown };
}

export type Px0 = ReturnType<typeof createPx0>;
