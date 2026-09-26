import { z } from "zod";
import { ProjectsSnapshotSchema, type HostProjects, type ProjectsReport, type ProjectsSnapshot } from "@/shared/projects";
import type { AgentTarget } from "../stats/service";

export type ProjectsDeps = { targets: () => AgentTarget[]; fetchJson: (url: string) => Promise<unknown>; pollMs: number; idleMs: number; linkMemoryMs: number; now?: () => number };

export function describeFailure(err: unknown): string {
  if (err instanceof z.ZodError) return "the agent sent projects in a shape this hub does not understand";
  const message = err instanceof Error ? err.message : String(err);
  return message.includes("404") ? "this agent is too old to report projects; update it" : message;
}

export function createProjects(deps: ProjectsDeps) {
  const now = deps.now ?? Date.now;
  const hosts = new Map<string, HostProjects>();
  const seenLinks = new Map<string, Map<string, { pid: number; port: number; at: number }>>();
  let at = 0;
  let askedAt = Number.NEGATIVE_INFINITY;
  let inflight: Promise<void> | null = null;

  function remember(host: string, snap: ProjectsSnapshot): ProjectsSnapshot {
    const t = now();
    const alive = new Set(snap.listeners.flatMap(l => (l.pid === null ? [] : [l.pid])));
    const known = seenLinks.get(host) ?? new Map<string, { pid: number; port: number; at: number }>();
    for (const l of snap.links) known.set(`${l.pid}:${l.port}`, { ...l, at: t });
    for (const [key, l] of known) if (t - l.at > deps.linkMemoryMs || !alive.has(l.pid)) known.delete(key);
    seenLinks.set(host, known);
    return { ...snap, links: [...known.values()].map(({ pid, port }) => ({ pid, port })) };
  }

  async function poll() {
    const targets = deps.targets();
    await Promise.all(
      targets.map(async t => {
        try {
          hosts.set(t.name, { host: t.name, snapshot: remember(t.name, ProjectsSnapshotSchema.parse(await deps.fetchJson(`${t.url}/projects`))), error: null });
        } catch (err: unknown) {
          hosts.set(t.name, { host: t.name, snapshot: hosts.get(t.name)?.snapshot ?? null, error: describeFailure(err) });
        }
      }),
    );
    const live = new Set(targets.map(t => t.name));
    for (const name of hosts.keys()) if (!live.has(name)) hosts.delete(name);
    at = now();
  }

  const pollOnce = () => {
    inflight ??= poll()
      .catch((err: unknown) => console.error("[projects] poll failed", err))
      .finally(() => {
        inflight = null;
      });
    return inflight;
  };
  const wanted = () => now() - askedAt < deps.idleMs;
  const report = (): ProjectsReport => ({ at, hosts: [...hosts.values()].sort((a, b) => a.host.localeCompare(b.host)) });
  const tick = async () => {
    if (wanted()) await pollOnce();
  };

  return {
    poll,
    report,
    tick,
    async fresh(): Promise<ProjectsReport> {
      const stale = !wanted() || now() - at >= deps.pollMs * 2;
      askedAt = now();
      if (stale) await pollOnce();
      return report();
    },
    start() {
      const loop = async () => {
        await tick();
        setTimeout(loop, deps.pollMs);
      };
      void loop();
    },
  };
}

export type ProjectsService = ReturnType<typeof createProjects>;
