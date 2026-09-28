import { hostname, homedir } from "node:os";
import { resolve } from "node:path";
import { serve, type BunRequest, type Server, type ServerWebSocket } from "bun";
import { z } from "zod";
import index from "./index.html";
import { ClientMessageSchema, DesktopMessageSchema, KillRequestSchema, type ServerMessage } from "@/shared/schema";
import { openDb } from "@/hub/db";
import { isLoadRange, loadStrip } from "@/hub/history";
import { loadConfig } from "@/hub/config";
import { createGithubClients } from "@/hub/githubApi";
import { readWrite } from "@/hub/http";
import { createHub } from "@/hub/poller";
import { createLaterRoutes } from "@/hub/later/routes";
import { laterItem } from "@/hub/later/store";
import { readySegments } from "@/hub/later/transcripts";
import { createCodeRoutes } from "@/hub/code/routes";
import { createShipRoutes } from "@/hub/ship/routes";
import type { CurrentWork } from "@/hub/later/worth";
import { createVendorRoutes } from "@/hub/vendor";
import { createWebApp } from "@/hub/web";
import { compressJson } from "@/hub/compress";
import { createNotes } from "@/hub/notes/routes";
import { createTasks } from "@/hub/tasks/routes";
import { createProjects } from "@/hub/projects/service";
import { createStatsRoutes } from "@/hub/stats/routes";
import { createAiStats } from "@/hub/stats/service";
import { createMirai } from "@/hub/mirai/routes";
type SocketData = { watching: string | null; desktopMachine: string | null };

const config = loadConfig();
const production = process.env.NODE_ENV === "production";
const webApp = production ? await createWebApp(`${import.meta.dir}/../dist`) : index;

const publicDir = `${import.meta.dir}/../public`;
const publicFile = (path: string, headers: Record<string, string> = {}) => () => new Response(Bun.file(`${publicDir}/${path}`), { headers });
const ICONS = ["icon.svg", "icon-192.png", "icon-512.png"] as const;
const pwaRoutes = {
  "/sw.js": publicFile("sw.js", { "cache-control": "no-cache" }),
  ...Object.fromEntries(ICONS.map(name => [`/icons/${name}`, publicFile(`icons/${name}`, { "cache-control": "public, max-age=86400" })])),
};

const db = openDb(config.server.dbPath);
const watchers = new Map<string, number>();

const setWatch = (ws: ServerWebSocket<SocketData>, name: string | null) => {
  const prev = ws.data.watching;
  if (prev) {
    ws.unsubscribe(`host:${prev}`);
    const n = (watchers.get(prev) ?? 1) - 1;
    if (n > 0) watchers.set(prev, n);
    else watchers.delete(prev);
  }
  ws.data.watching = name;
  if (name) {
    ws.subscribe(`host:${name}`);
    watchers.set(name, (watchers.get(name) ?? 0) + 1);
  }
};
const setDesktop = (ws: ServerWebSocket<SocketData>, machine: string | null) => {
  const prev = ws.data.desktopMachine;
  if (prev) ws.unsubscribe(`desktop:${prev}`);
  ws.data.desktopMachine = machine;
  if (machine) ws.subscribe(`desktop:${machine}`);
};

const hub = createHub({
  db,
  config: config.fleet,
  publish: (topic: string, msg: ServerMessage) => server.publish(topic, JSON.stringify(msg)),
  isWatched: () => server.subscriberCount("fleet-live") > 0,
  watchedHosts: () => new Set(watchers.keys()),
});

const { api: github, rest: githubRest, token: githubToken } = createGithubClients(config.github);

const tasks = createTasks({
  config: config.tasks,
  db,
  github,
  publish: msg => server.publish("tasks", JSON.stringify(msg)),
});

const ship = createShipRoutes({ config: config.ship, limits: config.tasks.remote, ranking: config.tasks.priority, db, github, rest: githubRest, linear: tasks.linearSnapshot });

async function currentWork(): Promise<CurrentWork> {
  const [linear, prs] = await Promise.all([tasks.linearSnapshot(), ship.mine().catch(() => [])]);
  const tickets = linear.kind === "ready" ? linear.issues.filter(i => i.column !== "done").map(i => `${i.identifier}: ${i.title}`) : [];
  return { tickets, pullRequests: prs.map(p => p.title) };
}

const code = createCodeRoutes({ config: config.code, px0: config.px0, org: config.ship.org, token: githubToken });
for (const signal of ["SIGTERM", "SIGINT"] as const) process.once(signal, () => void code.shutdown().finally(() => process.exit(0)));

const aiStats = createAiStats({ targets: hub.liveAgents, config: config.stats });

const projects = createProjects({
  targets: hub.liveAgents,
  pollMs: 10_000,
  idleMs: config.projects.idleMs,
  linkMemoryMs: 15 * 60_000,
  fetchJson: async url => {
    const res = await fetch(url, { signal: AbortSignal.timeout(config.projects.fetchTimeoutMs) });
    if (!res.ok) throw new Error(`${url} answered ${res.status}`);
    return res.json();
  },
});

const notes = createNotes({ config: config.notes, publish: msg => server.publish("notes", JSON.stringify(msg)) });

const mirai = await createMirai(
  config.mirai,
  {
    fleet: () => hub.fleet(),
    events: () => hub.recentEvents(),
    host: name => hub.detail(name),
    tasks: { local: () => tasks.localSnapshot(), linear: () => tasks.linearSnapshot(), github: () => tasks.githubSnapshot(), priority: () => tasks.prioritySnapshot() },
    ship: () => ship.snapshot(),
    stats: () => aiStats.report({ period: "7d", tz: "UTC", hidden: [] }),
    now: Date.now,
  },
  {
    machine: hostname(),
    home: homedir(),
    hubUrl: `http://127.0.0.1:${config.server.port}`,
    dbPath: resolve(config.server.dbPath),
    owner: config.mirai.owner,
    wikiDir: config.mirai.wikiDir,
    vaultDir: config.notes.vaultDir,
    agentPort: config.fleet.agentPort,
    hosts: () => hub.fleet()?.machines.map(m => m.ts.name) ?? [],
  },
  { item: id => laterItem(db, id), segments: videoId => readySegments(db, videoId) },
);

const server = serve<SocketData>({
  hostname: config.server.host,
  port: config.server.port,
  routes: {
    "/*": webApp,
    ...pwaRoutes,
    ...compressJson({
      "/api/settings": () => Response.json(config.settings),
      "/api/fleet": () => Response.json(hub.fleet()),
      "/api/events": () => Response.json(hub.recentEvents()),
      "/api/desktop/open": {
        POST: async (req: BunRequest) => {
          const r = await readWrite(req, z.object({ machine: z.string().min(1), path: z.string() }), "{ machine, path }");
          if (!r.ok) return r.res;
          const requestUrl = new URL(req.url);
          if (req.headers.get("origin") !== null && req.headers.get("origin") !== requestUrl.origin) {
            return Response.json({ error: "writes need a same-origin JSON request" }, { status: 403 });
          }
          if (!r.body.path.startsWith("/") || r.body.path.startsWith("//")) {
            return Response.json({ error: "path must be an absolute path on the hub" }, { status: 400 });
          }
          let target: URL;
          try {
            target = new URL(r.body.path, requestUrl);
          } catch {
            return Response.json({ error: "path must be an absolute path on the hub" }, { status: 400 });
          }
          if (target.origin !== requestUrl.origin) {
            return Response.json({ error: "path must be an absolute path on the hub" }, { status: 400 });
          }
          const topic = `desktop:${r.body.machine}`;
          const delivered = server.subscriberCount(topic);
          server.publish(topic, JSON.stringify({ type: "open", path: r.body.path } satisfies ServerMessage));
          return Response.json({ delivered });
        },
      },
      "/api/projects": async () => Response.json(await projects.fresh()),
      "/api/load": (req: BunRequest) => {
        const range = new URL(req.url).searchParams.get("range");
        return isLoadRange(range) ? Response.json(loadStrip(db, range)) : Response.json({ error: "range must be 1h, 24h or 7d" }, { status: 400 });
      },
      "/api/host/:name": (req: BunRequest<"/api/host/:name">) => {
        return Response.json(hub.detail(req.params.name));
      },
      "/api/host/:name/kill": {
        POST: async (req: BunRequest<"/api/host/:name/kill">) => {
          const r = await readWrite(req, KillRequestSchema, "{ pid, name, signal }");
          if (!r.ok) return r.res;
          const out = await hub.kill(req.params.name, r.body);
          return Response.json(out.body, { status: out.status });
        },
      },
      ...tasks.routes,
      ...notes.routes,
      ...ship.routes,
      ...code.routes,
      ...createLaterRoutes({ db, config: config.later, ranking: config.tasks.priority, work: currentWork, openOn: hub.openOn }),
      ...createVendorRoutes(),
      ...createStatsRoutes(aiStats),
      ...mirai.routes,
    }),
    "/ws": (req: BunRequest, srv: Server<SocketData>) => (srv.upgrade(req, { data: { watching: null, desktopMachine: null } }) ? undefined : new Response("upgrade failed", { status: 400 })),
  },
  websocket: {
    open(ws) {
      ws.subscribe("fleet");
      ws.subscribe("tasks");
      ws.subscribe("notes");
      const fleet = hub.fleet();
      if (fleet) ws.send(JSON.stringify({ type: "fleet", fleet } satisfies ServerMessage));
    },
    message(ws, raw) {
      let body: unknown;
      try {
        body = JSON.parse(String(raw));
      } catch {
        return;
      }
      const desktop = DesktopMessageSchema.safeParse(body);
      if (desktop.success) {
        setDesktop(ws, desktop.data.machine);
        return;
      }
      const parsed = ClientMessageSchema.safeParse(body);
      if (!parsed.success) return;
      const { fleet, host } = parsed.data;
      if (!fleet) ws.unsubscribe("fleet-live");
      else if (!ws.isSubscribed("fleet-live")) {
        ws.subscribe("fleet-live");
        hub.refreshVitals();
      }
      setWatch(ws, host);
      if (host) void hub.refreshDetail(host);
    },
    close(ws) {
      setWatch(ws, null);
      setDesktop(ws, null);
    },
  },
  development: !production && { hmr: true, console: true },
});

await Promise.all([hub.start(), tasks.start(), notes.start()]);
await aiStats.start();
projects.start();
console.log(`mirai hub on ${server.url}`);
