import { z } from "zod";

export const WorktreeSchema = z.object({
  path: z.string(),
  repo: z.string(),
  branch: z.string().nullable(),
  dirty: z.number(),
  ahead: z.number().nullable(),
  behind: z.number().nullable(),
  lastCommit: z.number().nullable(),
});

export const ListenerSchema = z.object({
  port: z.number(),
  bind: z.string(),
  pid: z.number().nullable(),
  process: z.string(),
  command: z.string(),
  cwd: z.string().nullable(),
  memBytes: z.number(),
});

export const ContainerSchema = z.object({
  name: z.string(),
  composeProject: z.string().nullable(),
  composeService: z.string().nullable(),
  workingDir: z.string().nullable(),
  ports: z.array(z.number()),
  memBytes: z.number(),
});

export const ProjectsSnapshotSchema = z.object({
  at: z.number(),
  root: z.string(),
  worktrees: z.array(WorktreeSchema),
  listeners: z.array(ListenerSchema),
  links: z.array(z.object({ pid: z.number(), port: z.number() })),
  containers: z.array(ContainerSchema),
});

export type Worktree = z.infer<typeof WorktreeSchema>;
export type Listener = z.infer<typeof ListenerSchema>;
export type Container = z.infer<typeof ContainerSchema>;
export type ProjectsSnapshot = z.infer<typeof ProjectsSnapshotSchema>;
export type HostProjects = { host: string; snapshot: ProjectsSnapshot | null; error: string | null };
export type ProjectsReport = { at: number; hosts: HostProjects[] };

export const PROJECT_VIEWS = ["stack", "treemap", "sky"] as const;
export type ProjectView = (typeof PROJECT_VIEWS)[number];
export const isProjectView = (v: string | undefined): v is ProjectView => PROJECT_VIEWS.some(p => p === v);

export type Flag = "cwd-deleted" | "no-worktree" | "double-bind";
export type ProjectKind = "repo" | "infra" | "orphans" | "tools";

export type Svc = {
  id: string;
  host: string;
  kind: "process" | "container";
  name: string;
  ports: number[];
  memBytes: number;
  pid: number | null;
  detail: string;
  flags: Flag[];
};

export type LaneWorktree = Worktree & { repoName: string };
export type Lane = { id: string; host: string; label: string; worktrees: LaneWorktree[]; services: Svc[] };
export type Project = { id: string; label: string; kind: ProjectKind; lanes: Lane[]; memBytes: number; idle: LaneWorktree[] };
export type Edge = { from: string; to: string };
export type Model = { projects: Project[]; edges: Edge[] };

const basename = (p: string): string => p.slice(p.lastIndexOf("/") + 1);
const within = (path: string, dir: string): boolean => path === dir || path.startsWith(`${dir}/`);
const DELETED = " (deleted)";
const tidy = (process: string): string => process.replace(/-MainThread$/, "");

function families(names: Iterable<string>): (name: string) => string {
  const byPrefix = new Map<string, Set<string>>();
  for (const n of names) {
    const prefix = n.split("-")[0] ?? n;
    byPrefix.set(prefix, (byPrefix.get(prefix) ?? new Set()).add(n));
  }
  return name => {
    const prefix = name.split("-")[0] ?? name;
    return (byPrefix.get(prefix)?.size ?? 0) > 1 ? prefix : name;
  };
}

type Placement = { project: string; label: string; kind: ProjectKind; lane: string; worktree: LaneWorktree | null };

type Draft = { project: Project; lanes: Map<string, Lane> };

export function buildModel(hosts: readonly HostProjects[], opts: { hidden: readonly string[]; tools: boolean }): Model {
  const familyOf = families(hosts.flatMap(h => h.snapshot?.worktrees.map(w => basename(w.repo)) ?? []));
  const drafts = new Map<string, Draft>();
  const edges: Edge[] = [];
  const idle = new Map<string, LaneWorktree[]>();

  const laneFor = (host: string, place: Placement): Lane => {
    const draft = drafts.get(place.project) ?? { project: { id: place.project, label: place.label, kind: place.kind, lanes: [], memBytes: 0, idle: [] }, lanes: new Map() };
    drafts.set(place.project, draft);
    const key = `${place.project}|${host}|${place.lane}`;
    const lane: Lane = draft.lanes.get(key) ?? { id: key, host, label: place.lane, worktrees: [], services: [] };
    draft.lanes.set(key, lane);
    if (place.worktree && !lane.worktrees.some(w => w.path === place.worktree?.path)) lane.worktrees.push(place.worktree);
    return lane;
  };

  for (const { host, snapshot } of hosts) {
    if (!snapshot || opts.hidden.includes(host)) continue;
    const trees: LaneWorktree[] = snapshot.worktrees.map(w => ({ ...w, repoName: basename(w.repo) })).sort((a, b) => b.path.length - a.path.length);
    const live = new Set<string>();
    const place = (dir: string | null): Placement | null => {
      if (dir === null) return null;
      const tree = trees.find(t => within(dir, t.path));
      if (!tree) return null;
      live.add(tree.path);
      const family = familyOf(tree.repoName);
      return { project: family, label: family, kind: "repo", lane: tree.path === tree.repo ? (tree.branch ?? tree.repoName) : basename(tree.path), worktree: tree };
    };
    const orphans: Placement = { project: "orphans", label: "no worktree", kind: "orphans", lane: host, worktree: null };
    const tools: Placement = { project: "tools", label: "host tools", kind: "tools", lane: host, worktree: null };
    const byPort = new Map<number, string>();

    const containerPorts = new Set(snapshot.containers.flatMap(c => c.ports));
    const pidsOnPort = new Map<number, Set<number>>();
    for (const l of snapshot.listeners) if (l.pid !== null) pidsOnPort.set(l.port, (pidsOnPort.get(l.port) ?? new Set()).add(l.pid));

    const byPid = new Map<number, Listener[]>();
    for (const l of snapshot.listeners) {
      if (l.pid === null) continue;
      byPid.set(l.pid, [...(byPid.get(l.pid) ?? []), l]);
    }
    const svcOfPid = new Map<number, string>();
    for (const [pid, ls] of byPid) {
      const first = ls[0];
      if (!first) continue;
      const ports = [...new Set(ls.map(l => l.port))].sort((a, b) => a - b);
      const rawCwd = first.cwd;
      const deleted = rawCwd?.endsWith(DELETED) ?? false;
      const cwd = deleted && rawCwd ? rawCwd.slice(0, -DELETED.length) : rawCwd;
      const flags: Flag[] = [];
      let placement = deleted ? null : place(cwd);
      if (!placement) {
        const underRoot = cwd !== null && within(cwd, snapshot.root);
        if (deleted) flags.push("cwd-deleted");
        else if (underRoot) flags.push("no-worktree");
        placement = deleted || underRoot ? orphans : tools;
      }
      if (ports.some(p => (pidsOnPort.get(p)?.size ?? 0) > 1)) flags.push("double-bind");
      if (placement.kind === "tools" && !opts.tools) continue;
      const id = `${host}:pid:${pid}`;
      const fromFolder = cwd !== null && (placement.kind === "orphans" || (placement.worktree !== null && cwd !== placement.worktree.path));
      laneFor(host, placement).services.push({ id, host, kind: "process", name: fromFolder && cwd ? basename(cwd) : tidy(first.process), ports, memBytes: first.memBytes, pid, detail: first.command || first.process, flags });
      svcOfPid.set(pid, id);
      for (const p of ports) byPort.set(p, id);
    }

    for (const l of snapshot.listeners) {
      if (l.pid !== null || containerPorts.has(l.port) || !opts.tools || byPort.has(l.port)) continue;
      const id = `${host}:port:${l.port}`;
      laneFor(host, tools).services.push({ id, host, kind: "process", name: l.process || `port ${l.port}`, ports: [l.port], memBytes: 0, pid: null, detail: l.bind, flags: [] });
      byPort.set(l.port, id);
    }

    for (const c of snapshot.containers) {
      const shared = c.composeProject !== null && c.workingDir !== null && within(c.workingDir, snapshot.root);
      const placement = place(c.workingDir) ?? (shared && c.composeProject ? { project: `infra:${c.composeProject}`, label: c.composeProject, kind: "infra" as const, lane: host, worktree: null } : tools);
      if (placement.kind === "tools" && !opts.tools) continue;
      const id = `${host}:container:${c.name}`;
      laneFor(host, placement).services.push({ id, host, kind: "container", name: c.composeService ?? c.name, ports: c.ports, memBytes: c.memBytes, pid: null, detail: c.name, flags: [] });
      for (const p of c.ports) byPort.set(p, id);
    }

    for (const link of snapshot.links) {
      const from = svcOfPid.get(link.pid);
      const to = byPort.get(link.port);
      if (from && to && from !== to && !edges.some(e => e.from === from && e.to === to)) edges.push({ from, to });
    }

    for (const t of trees) {
      if (live.has(t.path)) continue;
      const family = familyOf(t.repoName);
      idle.set(family, [...(idle.get(family) ?? []), t]);
    }
  }

  const order: Record<ProjectKind, number> = { repo: 0, infra: 1, orphans: 2, tools: 3 };
  const byPortThenPid = (a: Svc, b: Svc) => (a.ports[0] ?? 0) - (b.ports[0] ?? 0) || (a.pid ?? 0) - (b.pid ?? 0);
  const projects = [...drafts.values()]
    .map(({ project, lanes }): Project => {
      const sorted = [...lanes.values()].map(l => ({ ...l, services: [...l.services].sort(byPortThenPid) })).sort((a, b) => a.host.localeCompare(b.host) || a.label.localeCompare(b.label));
      return { ...project, lanes: sorted, memBytes: sorted.reduce((sum, l) => sum + l.services.reduce((s, x) => s + x.memBytes, 0), 0), idle: (idle.get(project.id) ?? []).sort((a, b) => a.path.localeCompare(b.path)) };
    })
    .sort((a, b) => order[a.kind] - order[b.kind] || b.memBytes - a.memBytes);
  return { projects, edges };
}

export type Rect = { x: number; y: number; w: number; h: number };

export function squarify<T extends { value: number }>(items: readonly T[], rect: Rect): (T & Rect)[] {
  const total = items.reduce((s, i) => s + i.value, 0);
  if (total <= 0 || rect.w <= 0 || rect.h <= 0) return [];
  let { x, y, w, h } = rect;
  const scale = (w * h) / total;
  let rest = [...items].sort((a, b) => b.value - a.value).map(item => ({ item, area: item.value * scale }));
  const out: (T & Rect)[] = [];
  const worst = (row: { area: number }[], side: number) => {
    const sum = row.reduce((s, r) => s + r.area, 0);
    const max = Math.max(...row.map(r => r.area));
    const min = Math.min(...row.map(r => r.area));
    return Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min));
  };
  while (rest.length) {
    const side = Math.min(w, h);
    const row = rest.slice(0, 1);
    let i = 1;
    for (; i < rest.length; i++) {
      const next = rest[i];
      if (!next || worst([...row, next], side) > worst(row, side)) break;
      row.push(next);
    }
    const sum = row.reduce((s, r) => s + r.area, 0);
    if (w >= h) {
      const cw = sum / h;
      let cy = y;
      for (const r of row) {
        const rh = r.area / cw;
        out.push({ ...r.item, x, y: cy, w: cw, h: rh });
        cy += rh;
      }
      x += cw;
      w -= cw;
    } else {
      const rh = sum / w;
      let cx = x;
      for (const r of row) {
        const cw = r.area / rh;
        out.push({ ...r.item, x: cx, y, w: cw, h: rh });
        cx += cw;
      }
      y += rh;
      h -= rh;
    }
    rest = rest.slice(i);
  }
  return out;
}

export function stackColumns(ids: readonly string[], edges: readonly Edge[]): Map<string, number> {
  const inside = new Set(ids);
  const local = edges.filter(e => inside.has(e.from) && inside.has(e.to));
  const col = new Map(ids.map(id => [id, 0]));
  for (let pass = 0; pass < ids.length; pass++) {
    let moved = false;
    for (const e of local) {
      const next = (col.get(e.from) ?? 0) + 1;
      if (next > (col.get(e.to) ?? 0) && next < ids.length) {
        col.set(e.to, next);
        moved = true;
      }
    }
    if (!moved) break;
  }
  return col;
}
