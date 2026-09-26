import { useId } from "react";
import { stackColumns, type Edge, type Lane, type Project, type Svc } from "@/shared/projects";
import { ago, bytes } from "../format";
import type { ViewProps } from "./ProjectsView";
import { FLAG_TEXT, ports, svcTitle, tint } from "./svc";

const NW = 184;
const NH = 52;
const COL_GAP = 56;
const ROW_GAP = 10;

type Placed = { svc: Svc; x: number; y: number; ghost: string | null };

function Node({ p, color, maxMem }: { p: Placed; color: (host: string) => string; maxMem: number }) {
  const bad = p.svc.flags.length > 0;
  const edge = bad ? "var(--color-bad)" : color(p.svc.host);
  return (
    <div
      title={svcTitle(p.svc)}
      className="absolute flex flex-col justify-center gap-1 overflow-hidden px-2.5"
      style={{ left: p.x, top: p.y, width: NW, height: NH, background: p.ghost ? "transparent" : "var(--color-raise)", boxShadow: `inset 0 0 0 1px ${p.ghost ? "var(--color-faint)" : tint(edge, 70)}` }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className={bad ? "truncate text-[11px] font-semibold text-bad" : "truncate text-[11px] font-semibold text-fg"}>{p.svc.name}</span>
        {p.svc.memBytes > 0 && <span className="shrink-0 text-[10px] text-dim">{bytes(p.svc.memBytes)}</span>}
      </div>
      <span className={bad ? "truncate text-[10px] text-bad" : "truncate text-[10px] text-dim"}>{p.ghost ?? [ports(p.svc), ...p.svc.flags.map(f => FLAG_TEXT[f])].join("  ")}</span>
      {!p.ghost && p.svc.memBytes > 0 && <span aria-hidden className="absolute bottom-0 left-0 h-[3px]" style={{ width: Math.max(2, (p.svc.memBytes / maxMem) * NW), background: edge }} />}
    </div>
  );
}

function LaneCanvas({ lane, edges, owner, color, maxMem }: { lane: Lane; edges: readonly Edge[]; owner: ReadonlyMap<string, { svc: Svc; project: Project }>; color: (host: string) => string; maxMem: number }) {
  const marker = useId();
  const mine = new Set(lane.services.map(s => s.id));
  const cols = stackColumns(
    lane.services.map(s => s.id),
    edges,
  );
  const outside = [...new Set(edges.filter(e => mine.has(e.from) && !mine.has(e.to)).map(e => e.to))];
  const lastCol = Math.max(0, ...cols.values()) + 1;
  const rows = new Map<number, number>();
  const placed = new Map<string, Placed>();
  const put = (svc: Svc, col: number, ghost: string | null) => {
    const row = rows.get(col) ?? 0;
    rows.set(col, row + 1);
    placed.set(svc.id, { svc, x: col * (NW + COL_GAP), y: row * (NH + ROW_GAP), ghost });
  };
  for (const s of lane.services) put(s, cols.get(s.id) ?? 0, null);
  for (const id of outside) {
    const hit = owner.get(id);
    if (hit) put(hit.svc, lastCol, `${hit.project.label} ${ports(hit.svc)}`);
  }
  const width = (Math.max(...rows.keys()) + 1) * (NW + COL_GAP) - COL_GAP;
  const height = Math.max(...rows.values()) * (NH + ROW_GAP) - ROW_GAP;
  const drawn = edges.filter(e => mine.has(e.from) && placed.has(e.to));

  return (
    <div className="relative shrink-0" style={{ width, height }}>
      <svg aria-hidden className="pointer-events-none absolute inset-0 overflow-visible" width={width} height={height}>
        <defs>
          <marker id={marker} viewBox="0 0 6 8" refX="6" refY="4" markerWidth="6" markerHeight="8" orient="auto">
            <path d="M0 0 L6 4 L0 8 Z" fill="var(--color-faint)" />
          </marker>
        </defs>
        {drawn.map(e => {
          const a = placed.get(e.from);
          const b = placed.get(e.to);
          if (!a || !b) return null;
          const x1 = a.x + NW;
          const y1 = a.y + NH / 2;
          const x2 = b.x;
          const y2 = b.y + NH / 2;
          const bend = Math.max(24, (x2 - x1) / 2);
          return <path key={`${e.from}>${e.to}`} d={`M${x1} ${y1} C${x1 + bend} ${y1} ${x2 - bend} ${y2} ${x2} ${y2}`} fill="none" stroke="var(--color-faint)" markerEnd={`url(#${marker})`} />;
        })}
      </svg>
      {[...placed.values()].map(p => (
        <Node key={p.svc.id} p={p} color={color} maxMem={maxMem} />
      ))}
    </div>
  );
}

function LaneLabel({ lane, color }: { lane: Lane; color: (host: string) => string }) {
  return (
    <div className="flex w-48 shrink-0 flex-col gap-1">
      <span className="text-[12px] font-semibold" style={{ color: color(lane.host) }}>
        {lane.label}
      </span>
      {lane.label !== lane.host && (
        <span className="text-[10px]" style={{ color: color(lane.host) }}>
          {lane.host}
        </span>
      )}
      {lane.worktrees.map(w => (
        <span key={w.path} title={w.path} className="mt-1 flex flex-col text-[10px]">
          <span className="truncate text-soft">{w.repoName}</span>
          <span className={w.branch === null ? "truncate text-warn" : "truncate text-dim"}>
            {[w.branch ?? "detached", w.dirty > 0 && `${w.dirty} dirty`, w.behind ? `↓${w.behind}` : null, w.ahead ? `↑${w.ahead}` : null, w.lastCommit && ago(w.lastCommit)].filter(Boolean).join("  ")}
          </span>
        </span>
      ))}
    </div>
  );
}

export function StackView({ model, color }: ViewProps) {
  const owner = new Map(model.projects.flatMap(project => project.lanes.flatMap(l => l.services.map(svc => [svc.id, { svc, project }] as const))));
  const maxMem = Math.max(1, ...[...owner.values()].map(o => o.svc.memBytes));
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      {model.projects.map(project => (
        <section key={project.id} aria-label={project.label} className="border-b border-rule px-4 py-5 md:px-6">
          <header className="mb-4 flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <h2 className={project.kind === "orphans" ? "m-0 text-[15px] font-semibold text-bad" : "m-0 text-[15px] font-semibold text-fg"}>{project.label}</h2>
            <span className="text-[10px] text-dim">
              {[project.kind === "repo" ? null : project.kind === "infra" ? "shared infra" : project.kind === "tools" ? "not in ~/Developer" : "running outside any worktree", `${project.lanes.length} ${project.lanes.length === 1 ? "lane" : "lanes"}`, bytes(project.memBytes)].filter(Boolean).join(" · ")}
            </span>
            {project.idle.length > 0 && (
              <span title={project.idle.map(w => w.path).join("\n")} className="text-[10px] text-faint">
                {project.idle.length} idle {project.idle.length === 1 ? "worktree" : "worktrees"}
              </span>
            )}
          </header>
          <div className="flex flex-col gap-6">
            {project.lanes.map(lane => (
              <div key={lane.id} className="flex gap-6">
                <LaneLabel lane={lane} color={color} />
                <LaneCanvas lane={lane} edges={model.edges} owner={owner} color={color} maxMem={maxMem} />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
