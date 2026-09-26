import { squarify, type Project, type Rect, type Svc } from "@/shared/projects";
import { bytes } from "../format";
import type { ViewProps } from "./ProjectsView";
import { ports, svcTitle, tint } from "./svc";
import { useSize } from "./useSize";

const HEADER = 40;
const GUTTER = 3;

function Tile({ svc, r, color }: { svc: Svc; r: Rect; color: (host: string) => string }) {
  const bad = svc.flags.length > 0;
  const hue = bad ? "var(--color-bad)" : color(svc.host);
  const roomy = r.w > 84 && r.h > 42;
  return (
    <div
      title={svcTitle(svc)}
      className="absolute overflow-hidden px-2 py-1.5"
      style={{ left: r.x, top: r.y, width: Math.max(0, r.w - GUTTER), height: Math.max(0, r.h - GUTTER), background: tint(hue, bad ? 10 : 16), boxShadow: `inset 0 0 0 1px ${tint(hue, 40)}` }}
    >
      {roomy ? (
        <>
          <div className={r.w > 220 ? "truncate text-[13px] font-semibold text-fg" : "truncate text-[11px] font-semibold text-fg"}>{svc.name}</div>
          <div className="truncate text-[10px] text-dim">
            {ports(svc)} {bytes(svc.memBytes)}
          </div>
        </>
      ) : (
        r.w > 44 && r.h > 18 && <div className="truncate text-[9px] text-soft">{ports(svc)}</div>
      )}
    </div>
  );
}

function Block({ project, r, color, floor }: { project: Project; r: Rect; color: (host: string) => string; floor: number }) {
  const services = project.lanes.flatMap(l => l.services);
  const hosts = [...new Set(project.lanes.map(l => l.host))];
  const tiles = squarify(
    services.map(svc => ({ svc, value: Math.max(svc.memBytes, floor) })),
    { x: 4, y: HEADER, w: r.w - 8 - GUTTER, h: r.h - HEADER - 4 - GUTTER },
  );
  const orphan = project.kind === "orphans";
  return (
    <section
      aria-label={project.label}
      className="absolute overflow-hidden bg-raise"
      style={{ left: r.x, top: r.y, width: r.w - GUTTER, height: r.h - GUTTER, boxShadow: orphan ? "inset 0 0 0 1px var(--color-bad)" : undefined }}
    >
      <div className="absolute top-2 right-2.5 left-2.5 flex items-baseline justify-between gap-2">
        <span className={orphan ? "truncate text-[12px] font-semibold text-bad" : "truncate text-[12px] font-semibold text-fg"}>{project.label}</span>
        <span className="shrink-0 text-[10px] text-dim">{bytes(project.memBytes)}</span>
      </div>
      {r.w > 200 && <div className="absolute top-[22px] left-2.5 truncate text-[10px] text-dim">{hosts.join(" · ")}</div>}
      {tiles.map(t => (
        <Tile key={t.svc.id} svc={t.svc} r={t} color={color} />
      ))}
    </section>
  );
}

export function TreemapView({ model, color }: ViewProps) {
  const { ref, w, h } = useSize<HTMLDivElement>();
  const total = model.projects.reduce((s, p) => s + p.memBytes, 0);
  const floor = Math.max(1, total * 0.006);
  const blocks = squarify(
    model.projects.map(project => ({ project, value: project.lanes.reduce((s, l) => s + l.services.reduce((a, x) => a + Math.max(x.memBytes, floor), 0), 0) })),
    { x: 0, y: 0, w, h },
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col px-4 pt-3 pb-4 md:px-6">
      <span className="mb-2 text-[10px] text-dim">area is memory, colour is the machine</span>
      <div ref={ref} className="relative min-h-[420px] flex-1">
        {blocks.map(b => (
          <Block key={b.project.id} project={b.project} r={b} color={color} floor={floor} />
        ))}
      </div>
    </div>
  );
}
