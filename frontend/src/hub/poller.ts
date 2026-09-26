import { desc, gte, lt } from "drizzle-orm";
import { z } from "zod";
import {
  AgentTailnetSchema,
  HostDetailSchema,
  MetricsSchema,
  type AgentTailnet,
  type Fleet,
  type FleetEvent,
  type HostDetail,
  type KillRequest,
  type ServerMessage,
  type TailnetInfo,
} from "@/shared/schema";
import { readStatus } from "@/shared/tailscale";
import type { Db } from "./db";
import { events, samples } from "./db/schema";
import { deriveEvents, nextHotLatch, type HotLatch } from "./events";
import type { Config } from "./config";
import { SAMPLE_MS } from "./history";
import { buildEdges, buildMachines, latestVersion, tailnetInfos, type AgentState } from "./fleet";
import { createLoop } from "./loop";

export type HubDeps = {
  db: Db;
  config: Config["fleet"];
  publish: (topic: string, msg: ServerMessage) => void;
  isWatched: () => boolean;
  watchedHosts: () => ReadonlySet<string>;
};

export type AgentReply = { status: number; body: unknown };

async function getJson(url: string, timeoutMs: number): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

export function createHub(deps: HubDeps) {
  const { db, config } = deps;
  const getAgent = (url: string) => getJson(url, config.agentTimeoutMs);
  let infos: TailnetInfo[] = [];
  let tailnet = "";
  const agents = new Map<string, AgentState>();
  const pings = new Map<string, AgentTailnet>();
  const details = new Map<string, HostDetail>();
  const minute = new Map<string, { cpu: number; mem: number; temp: number | null; n: number }>();
  let fleet: Fleet | null = null;
  let hotLatch: HotLatch = new Set();
  const lastEventAt = new Map(
    db
      .select()
      .from(events)
      .where(gte(events.at, Date.now() - config.eventRepeatMs))
      .all()
      .map((e): [string, number] => [`${e.machine}|${e.message}`, e.at]),
  );

  const agentUrl = (ip: string, path: string) => `http://${ip}:${config.agentPort}${path}`;

  async function postAgent(name: string, path: string, payload: unknown): Promise<AgentReply> {
    const host = infos.find(i => i.name === name && i.online);
    if (!host) return { status: 404, body: { error: `${name} is not online` } };
    try {
      const res = await fetch(agentUrl(host.ip, path), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(config.killTimeoutMs),
      });
      return { status: res.status, body: await res.json() };
    } catch {
      return { status: 502, body: { error: `mirai-agent on ${name} did not answer` } };
    }
  }
  const tier = (t: { watched: number; idle: number }) => (deps.isWatched() ? t.watched : t.idle);

  async function discover() {
    const status = await readStatus(config.tailscaleBin);
    infos = tailnetInfos(status);
    tailnet = status.MagicDNSSuffix ?? "";
  }

  async function pollVitals() {
    await Promise.all(
      infos.map(async i => {
        const prev = agents.get(i.name) ?? { metrics: null, failures: 0 };
        if (!i.online) {
          agents.set(i.name, { metrics: prev.metrics, failures: Number.MAX_SAFE_INTEGER });
          return;
        }
        try {
          const metrics = MetricsSchema.parse(await getAgent(agentUrl(i.ip, "/metrics")));
          agents.set(i.name, { metrics, failures: 0 });
          const acc = minute.get(i.name) ?? { cpu: 0, mem: 0, temp: null, n: 0 };
          const t = metrics.temp?.cpu ?? null;
          minute.set(i.name, {
            cpu: acc.cpu + metrics.cpu.load,
            mem: acc.mem + (metrics.mem.used / metrics.mem.total) * 100,
            temp: t === null ? acc.temp : (acc.temp ?? 0) + t,
            n: acc.n + 1,
          });
        } catch {
          agents.set(i.name, { metrics: prev.metrics, failures: prev.failures + 1 });
        }
      }),
    );
    publishFleet();
  }

  async function pollPings() {
    await Promise.all(
      infos
        .filter(i => agents.get(i.name)?.failures === 0)
        .map(async i => {
          try {
            pings.set(i.name, AgentTailnetSchema.parse(await getAgent(agentUrl(i.ip, "/tailnet"))));
          } catch {
            pings.delete(i.name);
          }
        }),
    );
  }

  async function pollDetail(only?: string) {
    const watched = deps.watchedHosts();
    await Promise.all(
      infos
        .filter(i => watched.has(i.name) && i.online && (only === undefined || i.name === only))
        .map(async i => {
          try {
            const detail = HostDetailSchema.parse(await getAgent(agentUrl(i.ip, "/detail")));
            details.set(i.name, detail);
            deps.publish(`host:${i.name}`, { type: "host", name: i.name, detail });
          } catch (err: unknown) {
            const error = err instanceof z.ZodError ? "the agent sent processes in a shape this hub does not understand" : err instanceof Error ? err.message : String(err);
            deps.publish(`host:${i.name}`, { type: "host-error", name: i.name, error, at: Date.now() });
          }
        }),
    );
  }

  const recentEvents = (): FleetEvent[] => db.select().from(events).orderBy(desc(events.at), desc(events.id)).limit(config.eventsShown).all();

  function publishFleet() {
    const machines = buildMachines(infos, agents, config.maxAgentFailures);
    const next: Fleet = {
      at: Date.now(),
      tailnet,
      machines,
      edges: buildEdges(pings, new Set(machines.map(m => m.ts.name))),
      latestVersion: latestVersion(machines.map(m => m.ts.version)),
    };
    const at = Date.now();
    const fresh = deriveEvents(fleet, next, config.thresholds, hotLatch).filter(e => {
      const key = `${e.machine}|${e.message}`;
      if (at - (lastEventAt.get(key) ?? 0) < config.eventRepeatMs) return false;
      lastEventAt.set(key, at);
      return true;
    });
    fleet = next;
    hotLatch = nextHotLatch(next, config.thresholds, hotLatch);
    if (fresh.length) {
      db.insert(events).values(fresh.map(e => ({ ...e, at }))).run();
      deps.publish("fleet", { type: "events", events: recentEvents() });
    }
    deps.publish("fleet", { type: "fleet", fleet: next });
  }

  function rollup() {
    const at = Math.floor(Date.now() / SAMPLE_MS) * SAMPLE_MS;
    const rows = [...minute].map(([machine, a]) => ({ machine, at, cpu: a.cpu / a.n, mem: a.mem / a.n, temp: a.temp === null ? null : a.temp / a.n }));
    minute.clear();
    if (rows.length) db.insert(samples).values(rows).onConflictDoNothing().run();
    db.delete(samples).where(lt(samples.at, Date.now() - config.retainMs)).run();
  }

  const vitalsLoop = createLoop(pollVitals, () => tier(config.every.vitals), "vitals");

  return {
    async start() {
      await discover();
      await pollVitals();
      createLoop(discover, () => tier(config.every.discovery), "discovery").start();
      vitalsLoop.start();
      createLoop(pollPings, () => tier(config.every.pings), "pings").start();
      createLoop(() => pollDetail(), () => config.every.detail, "detail").start();
      setInterval(rollup, SAMPLE_MS);
    },
    fleet: () => fleet,
    detail: (name: string) => details.get(name) ?? null,
    recentEvents,
    refreshDetail: (name: string) => pollDetail(name),
    refreshVitals: () => vitalsLoop.now(),
    async kill(name: string, req: KillRequest): Promise<AgentReply> {
      const out = await postAgent(name, "/kill", req);
      if (out.status === 200) void pollDetail(name);
      return out;
    },
    openOn: (name: string, url: string): Promise<AgentReply> => postAgent(name, "/open", { url }),
    liveAgents: () => infos.filter(i => i.online && agents.get(i.name)?.failures === 0).map(i => ({ name: i.name, url: agentUrl(i.ip, "") })),
  };
}

export type Hub = ReturnType<typeof createHub>;
