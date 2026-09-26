import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { Fleet, FleetEvent, HostDetail, Machine } from "@/shared/schema";
import type { ShipPr, ShipSnapshot } from "@/shared/ship";
import type { GithubIssue, GithubSnapshot, LinearIssue, LinearSnapshot, LocalSnapshot, PrioritySnapshot } from "@/shared/tasks";
import type { UsageReport } from "@/shared/usage";

export type MiraiSources = {
  fleet: () => Fleet | null;
  events: () => readonly FleetEvent[];
  host: (name: string) => HostDetail | null;
  tasks: {
    local: () => LocalSnapshot;
    linear: () => Promise<LinearSnapshot>;
    github: () => Promise<GithubSnapshot>;
    priority: () => Promise<PrioritySnapshot>;
  };
  ship: () => Promise<ShipSnapshot>;
  stats: () => Promise<UsageReport>;
  now: () => number;
};

const MAX_STRING = 400;
const MAX_ITEMS = 60;
const BUDGET = 16_000;

function prune(value: unknown, depth: number): unknown {
  if (typeof value === "string") return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  if (Array.isArray(value)) {
    const kept = value.slice(0, MAX_ITEMS).map(v => prune(v, depth + 1));
    return value.length > MAX_ITEMS ? [...kept, `+${value.length - MAX_ITEMS} more`] : kept;
  }
  if (value === null || typeof value !== "object") return value;
  if (depth > 8) return "…";
  return Object.fromEntries(Object.entries(value).flatMap(([k, v]) => (v === undefined ? [] : [[k, prune(v, depth + 1)]])));
}

export function compact(value: unknown): string {
  const text = JSON.stringify(prune(value, 0));
  return text.length > BUDGET ? `${text.slice(0, BUDGET)}…(truncated)` : text;
}

const iso = (at: number) => new Date(at).toISOString();
const gb = (bytes: number) => Math.round((bytes / 1e9) * 10) / 10;

function machineSummary(m: Machine) {
  const base = { name: m.ts.name, href: `/machines/${encodeURIComponent(m.ts.name)}`, online: m.ts.online, state: m.kind };
  if (m.kind !== "live") return base;
  const { cpu, mem, temp, disks, failedServices, topProcs, uptimeSec, at } = m.metrics;
  return {
    ...base,
    at: iso(at),
    cpuPct: cpu.load,
    loadAvg: cpu.loadAvg,
    memUsedGb: gb(mem.used),
    memTotalGb: gb(mem.total),
    memFreeGb: gb(mem.free),
    swapUsedGb: gb(mem.swapUsed),
    tempC: temp?.cpu ?? null,
    fullestDiskPct: disks.reduce((max, d) => Math.max(max, d.size ? Math.round((d.used / d.size) * 100) : 0), 0),
    failedServices,
    topProcs: topProcs.slice(0, 5),
    uptimeHours: Math.round(uptimeSec / 3600),
  };
}

const linearIssue = (i: LinearIssue) => ({
  id: i.identifier,
  title: i.title,
  url: i.url,
  priority: i.priority,
  state: i.stateName,
  assignee: i.assignee ? (i.assignee.isMe ? "me" : i.assignee.name) : null,
  cycleEndsAt: i.cycle?.endsAt ?? null,
  updatedAt: i.updatedAt,
});

const githubIssue = (i: GithubIssue) => ({
  ref: `${i.repo}#${i.number}`,
  title: i.title,
  url: i.url,
  column: i.column,
  labels: i.labels.map(l => l.name),
  assignedToMe: i.assignedToMe,
  pullRequests: i.pullRequests.map(p => `${p.repo}#${p.number} ${p.state}`),
});

const shipPr = (p: ShipPr) => ({
  ref: `${p.repo}#${p.number}`,
  title: p.title,
  url: p.url,
  author: p.author,
  state: p.state,
  why: p.why,
  draft: p.draft,
  conflicts: p.conflicts,
  failedChecks: p.checks.filter(c => c.conclusion === "failed").map(c => c.name),
  pendingChecks: p.checks.filter(c => c.conclusion === "pending").length,
  reviews: p.reviews.map(r => `${r.login}: ${r.state}`),
  waitingOn: p.pending,
  relation: p.relation,
  newCommits: p.newCommits,
  size: `+${p.additions} -${p.deletions} in ${p.changedFiles} files`,
  updatedAt: p.updatedAt,
});

function localTasks(s: LocalSnapshot) {
  if (s.kind !== "ready") return s;
  const open = s.tasks.filter(t => t.state === "open" || t.state === "doing");
  return { changedAt: iso(s.changedAt), today: s.today, open: open.map(t => ({ title: t.title, state: t.state, date: t.date, subtasks: t.subtasks })), doneCount: s.tasks.length - open.length };
}

function linearTasks(s: LinearSnapshot) {
  if (s.kind !== "ready") return s;
  const open = s.issues.filter(i => i.column !== "done");
  return { fetchedAt: iso(s.fetchedAt), open: open.map(linearIssue), doneRecently: s.issues.length - open.length };
}

function githubTasks(s: GithubSnapshot) {
  if (s.kind !== "ready") return s;
  const open = s.issues.filter(i => i.column !== "closed");
  return { fetchedAt: iso(s.fetchedAt), open: open.map(githubIssue), closedRecently: s.issues.length - open.length };
}

function priorityTasks(s: PrioritySnapshot) {
  if (s.kind !== "ready") return s;
  return { rankedAt: iso(s.rankedAt), items: s.items.map(({ ref, title, source, reason }) => ({ ref, title, source, reason })), more: s.more, unranked: s.unranked };
}

function shipSummary(s: ShipSnapshot, queue: string | undefined) {
  if (s.kind !== "ready") return s;
  return {
    fetchedAt: iso(s.fetchedAt),
    me: s.me,
    ...(queue !== "review" ? { mine: s.mine.map(shipPr) } : {}),
    ...(queue !== "mine" ? { waitingOnMyReview: s.review.map(shipPr) } : {}),
  };
}

const statsSummary = (r: UsageReport) => ({
  at: iso(r.at),
  period: r.period,
  totalUsd: r.totals.costUsd,
  sessions: r.totals.sessions,
  providers: r.providers.map(p => ({ provider: p.provider, usd: p.costUsd, tokens: p.tokens, sessions: p.sessions })),
  machines: r.machines.map(m => ({ name: m.name, usd: m.costUsd, sessions: m.sessions })),
  topModels: r.models.slice(0, 8).map(m => ({ model: m.model, usd: m.costUsd, sessions: m.sessions })),
  limits: r.limits,
});

async function summarised<T, S>(read: () => T | Promise<T>, summary: (value: T) => S): Promise<S | { error: string }> {
  try {
    return summary(await read());
  } catch (err: unknown) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

const TASK_SOURCES = ["local", "linear", "github", "priority"] as const;
type TaskSource = (typeof TASK_SOURCES)[number];
const DEFAULT_TASKS: readonly TaskSource[] = ["local", "linear", "github"];

export function createMiraiReads(src: MiraiSources) {
  const stamped = (data: unknown) => ({ readAt: iso(src.now()), data });
  const taskReaders: Record<TaskSource, () => Promise<unknown>> = {
    local: () => summarised(src.tasks.local, localTasks),
    linear: () => summarised(src.tasks.linear, linearTasks),
    github: () => summarised(src.tasks.github, githubTasks),
    priority: () => summarised(src.tasks.priority, priorityTasks),
  };
  return {
    machines(host: string | undefined) {
      const fleet = src.fleet();
      if (!host) return stamped({ fleetAt: fleet ? iso(fleet.at) : null, machines: fleet?.machines.map(machineSummary) ?? [], events: src.events().slice(0, 12) });
      const machine = fleet?.machines.find(m => m.ts.name === host);
      if (!machine) return stamped({ error: `${host} is not a machine on this tailnet`, known: fleet?.machines.map(m => m.ts.name) ?? [] });
      const detail = src.host(host);
      return stamped({
        detailAt: detail ? iso(detail.at) : null,
        machine: machineSummary(machine),
        processes: detail?.processes.toSorted((a, b) => b.cpu - a.cpu).slice(0, 15).map(({ pid, name, user, cpu, memBytes, started }) => ({ pid, name, user, cpu, memGb: gb(memBytes), started })) ?? null,
        ports: detail?.ports ?? null,
        services: detail?.services ?? null,
      });
    },
    async tasks(source: string | undefined) {
      const wanted = TASK_SOURCES.filter(s => s === source);
      const sources = wanted.length > 0 ? wanted : DEFAULT_TASKS;
      const entries = await Promise.all(sources.map(async s => [s, await taskReaders[s]()] as const));
      return stamped(Object.fromEntries(entries));
    },
    ship: async (queue: string | undefined) => stamped(await summarised(src.ship, s => shipSummary(s, queue))),
    stats: async () => stamped(await summarised(src.stats, statsSummary)),
  };
}

const text = (payload: unknown) => ({ content: [{ type: "text" as const, text: compact(payload) }], details: undefined });

export function createMiraiTools(src: MiraiSources): ToolDefinition[] {
  const reads = createMiraiReads(src);
  return [
    defineTool({
      name: "machines",
      label: "machines",
      description: "The fleet of the user's machines on the tailnet: CPU, memory, temperature, disks, failed services, top processes and recent events. Pass host for one machine's processes, listening ports and services.",
      parameters: Type.Object({ host: Type.Optional(Type.String({ description: "machine name, as the machines tool lists it" })) }),
      execute: async (_id, params) => text(reads.machines(params.host)),
    }),
    defineTool({
      name: "tasks",
      label: "tasks",
      description: "The user's open tasks: local daily-note tasks, Linear issues and GitHub issues. Pass source to read one of them, or source priority for the ranked list of what to do next.",
      parameters: Type.Object({ source: Type.Optional(Type.Union(TASK_SOURCES.map(s => Type.Literal(s)))) }),
      execute: async (_id, params) => text(await reads.tasks(params.source)),
    }),
    defineTool({
      name: "ship",
      label: "ship",
      description: "Pull requests: the user's own open ones (mine) with check and review state, and the ones waiting on their review (review). Omit queue for both.",
      parameters: Type.Object({ queue: Type.Optional(Type.Union([Type.Literal("mine"), Type.Literal("review")])) }),
      execute: async (_id, params) => text(await reads.ship(params.queue)),
    }),
    defineTool({
      name: "stats",
      label: "stats",
      description: "The user's Claude Code and Codex usage and spend across machines for the last seven days, with plan limits.",
      parameters: Type.Object({}),
      execute: async () => text(await reads.stats()),
    }),
  ];
}
