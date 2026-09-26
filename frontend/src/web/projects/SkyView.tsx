import type { Project, Svc } from "@/shared/projects";
import { bytes } from "../format";
import type { ViewProps } from "./ProjectsView";
import { ports, svcTitle, tint } from "./svc";
import { useSize } from "./useSize";

const MB = 1 << 20;

type Star = { svc: Svc; project: Project; x: number; y: number; r: number; right: boolean };
type Hub = { project: Project; x: number; y: number; ring: number };

const LABEL_ROOM = 150;
const ROW_GAP = 96;

function layout(projects: readonly Project[], w: number): { hubs: Hub[]; stars: Star[]; height: number } {
  if (!projects.length || !w) return { hubs: [], stars: [], height: 0 };
  const sized = projects.map(project => {
    const services = project.lanes.flatMap(l => l.services);
    const ring = Math.min(Math.max(40, (w - 2 * LABEL_ROOM) / 2), 44 + services.length * 13);
    return { project, services, ring, width: 2 * ring + 2 * LABEL_ROOM };
  });
  const rows: (typeof sized)[] = [];
  for (const item of sized) {
    const row = rows.at(-1);
    if (row && row.reduce((s, x) => s + x.width, 0) + item.width <= w) row.push(item);
    else rows.push([item]);
  }
  const hubs: Hub[] = [];
  const stars: Star[] = [];
  let top = 64;
  for (const row of rows) {
    const tallest = Math.max(...row.map(x => x.ring));
    const used = row.reduce((s, x) => s + x.width, 0);
    let left = (w - used) / 2;
    for (const { project, services, ring, width } of row) {
      const x = left + width / 2;
      const y = top + tallest;
      hubs.push({ project, x, y, ring });
      services.forEach((svc, j) => {
        const angle = ((-90 + ((j + 0.5) * 360) / services.length) * Math.PI) / 180;
        const sx = x + Math.cos(angle) * ring;
        stars.push({ svc, project, x: sx, y: y + Math.sin(angle) * ring, r: Math.min(ring * 0.3, 4 + Math.sqrt(svc.memBytes / MB) * 1.5), right: sx >= x - 1 });
      });
      left += width;
    }
    top += 2 * tallest + ROW_GAP;
  }
  return { hubs, stars, height: top };
}

export function SkyView({ model, color }: ViewProps) {
  const { ref, w } = useSize<HTMLDivElement>();
  const { hubs, stars, height } = layout(model.projects, w);
  const at = new Map(stars.map(s => [s.svc.id, s]));
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-3 pb-4 md:px-6">
      <span className="text-[10px] text-dim">each ring is a project, dot size is memory, lines are live connections</span>
      <div ref={ref} className="relative w-full">
        <svg width={w} height={height} className="block overflow-visible font-mono">
          {stars.map(s => {
            const hub = hubs.find(x => x.project.id === s.project.id);
            return hub ? <line key={`spoke-${s.svc.id}`} x1={hub.x} y1={hub.y} x2={s.x} y2={s.y} stroke="var(--color-rule)" /> : null;
          })}
          {model.edges.map(e => {
            const a = at.get(e.from);
            const b = at.get(e.to);
            if (!a || !b) return null;
            const cross = a.project.id !== b.project.id;
            const mx = (a.x + b.x) / 2;
            const my = (a.y + b.y) / 2 - (cross ? Math.abs(a.x - b.x) * 0.15 : 0);
            return <path key={`${e.from}>${e.to}`} d={`M${a.x} ${a.y} Q${mx} ${my} ${b.x} ${b.y}`} fill="none" stroke={cross ? "var(--color-soft)" : "var(--color-faint)"} strokeOpacity={cross ? 0.5 : 1} strokeDasharray={cross ? "3 4" : undefined} />;
          })}
          {hubs.map(hub => (
            <g key={hub.project.id}>
              <circle cx={hub.x} cy={hub.y} r={hub.ring} fill="none" stroke="var(--color-track)" />
              <circle cx={hub.x} cy={hub.y} r={5} fill="var(--color-bg)" stroke={hub.project.kind === "orphans" ? "var(--color-bad)" : "var(--color-fg)"} strokeWidth={2} />
              <text x={hub.x} y={hub.y - hub.ring - 30} textAnchor="middle" fontSize={13} fontWeight={600} fill={hub.project.kind === "orphans" ? "var(--color-bad)" : "var(--color-fg)"} paintOrder="stroke" stroke="var(--color-bg)" strokeWidth={4}>
                {hub.project.label}
              </text>
              <text x={hub.x} y={hub.y - hub.ring - 15} textAnchor="middle" fontSize={10} fill="var(--color-dim)" paintOrder="stroke" stroke="var(--color-bg)" strokeWidth={4}>
                {[...new Set(hub.project.lanes.map(l => l.host))].join(" · ")} · {bytes(hub.project.memBytes)}
              </text>
            </g>
          ))}
          {stars.map(s => {
            const bad = s.svc.flags.length > 0;
            const hue = bad ? "var(--color-bad)" : color(s.svc.host);
            const tx = s.right ? s.x + s.r + 7 : s.x - s.r - 7;
            const anchor = s.right ? "start" : "end";
            return (
              <g key={s.svc.id}>
                <title>{svcTitle(s.svc)}</title>
                <circle cx={s.x} cy={s.y} r={s.r} fill={tint(hue, 22)} stroke={hue} />
                <text x={tx} y={s.y - 2} textAnchor={anchor} fontSize={11} fontWeight={600} fill={bad ? "var(--color-bad)" : "var(--color-fg)"}>
                  {s.svc.name}
                </text>
                <text x={tx} y={s.y + 11} textAnchor={anchor} fontSize={10} fill={bad ? "var(--color-bad)" : "var(--color-dim)"}>
                  {ports(s.svc)} {s.svc.memBytes > 0 ? bytes(s.svc.memBytes) : ""}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
