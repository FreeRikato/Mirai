import { useLayoutEffect, useRef, useState } from "react";
import type { Edge, Fleet, Machine } from "@/shared/schema";
import { useFleetSlice } from "../api";
import { isHot, meshLayout } from "../derive";
import { ago } from "../format";
import { hrefFor, navigate } from "../router";
import { useSettings } from "../settings";

const FULL = { h: 540, label: 30, edge: "full", halo: 30, dot: 8, nameAt: { above: -60, below: 54 }, subAt: { above: -38, below: 76 }, sidePad: 120, legend: true };
const COMPACT = { h: 320, label: 20, edge: "short", halo: 20, dot: 6, nameAt: { above: -40, below: 36 }, subAt: { above: -24, below: 52 }, sidePad: 84, legend: false };
const COMPACT_BELOW = 560;
const EDGE_LABELS_UP_TO = 6;
const NAME_CHARS = 16;

const shortName = (name: string) => (name.length > NAME_CHARS ? `${name.slice(0, NAME_CHARS - 1)}…` : name);

function useWidth<T extends Element>(fallback: number) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => entry && setWidth(Math.round(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

function subtitle(m: Machine, tempHotC: number): { text: string; hot: boolean } {
  if (m.kind === "offline") return { text: `offline, seen ${ago(m.ts.lastSeen)} ago`, hot: false };
  if (m.kind === "no-agent") return { text: `${m.ts.ip}  no agent`, hot: false };
  const t = m.metrics.temp;
  const b = m.metrics.battery;
  const hot = isHot(m, tempHotC);
  const stat = hot && t ? `${Math.round(t.cpu)}°C` : b ? `bat ${b.percent}%` : t ? `${Math.round(t.cpu)}°C` : "";
  return { text: `${m.ts.ip}  ${stat}`.trim(), hot };
}

type MeshNode = { name: string; color: string; kind: Machine["kind"]; sub: string; hot: boolean };
type MeshModel = { nodes: readonly MeshNode[]; edges: readonly Edge[] };

const EMPTY: MeshModel = { nodes: [], edges: [] };

function meshModel(fleet: Fleet | null, tempHotC: number): MeshModel {
  if (!fleet) return EMPTY;
  const nodes = fleet.machines.map(m => {
    const sub = subtitle(m, tempHotC);
    return { name: m.ts.name, color: m.color, kind: m.kind, sub: sub.text, hot: sub.hot };
  });
  return { nodes, edges: fleet.edges };
}

export function Mesh() {
  const { fleet: limits } = useSettings();
  const { data: model = EMPTY } = useFleetSlice(fleet => meshModel(fleet, limits.tempHotC));
  const [ref, W] = useWidth<HTMLDivElement>(780);
  const size = W < COMPACT_BELOW ? COMPACT : FULL;
  const H = size.h;
  const pos = meshLayout(
    model.nodes.map(n => n.name),
    W,
    H,
    size.sidePad,
  );
  const at = (name: string) => pos.get(name) ?? { x: W / 2, y: H / 2 };
  const open = (name: string) => navigate(hrefFor(name));
  const [focus, setFocus] = useState<string | null>(null);
  const touches = (e: Edge) => focus !== null && (e.a === focus || e.b === focus);
  const labelled = (e: Edge) => model.edges.length <= EDGE_LABELS_UP_TO || touches(e);

  return (
    <div ref={ref} className="relative h-full w-full">
      {model.nodes
        .filter(m => m.kind === "live")
        .map(m => {
          const p = at(m.name);
          return (
            <span
              key={m.name}
              data-live-halo={m.name}
              aria-hidden
              className="pointer-events-none absolute animate-live rounded-full motion-reduce:animate-none"
              style={{ left: p.x - size.halo, top: p.y - size.halo, width: size.halo * 2, height: size.halo * 2, background: m.color }}
            />
          );
        })}
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="relative block" role="group" aria-label="tailnet mesh">
        {model.edges.map(e => {
          const a = at(e.a);
          const b = at(e.b);
          const relay = e.via === "relay";
          return (
            <line
              key={`${e.a}-${e.b}`}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={relay ? "var(--color-warn)" : "var(--color-fg)"}
              strokeWidth={relay ? 1 : 2}
              opacity={focus === null || touches(e) ? 1 : 0.2}
            />
          );
        })}
        {model.edges.filter(labelled).map(e => {
          const a = at(e.a);
          const b = at(e.b);
          const relay = e.via === "relay";
          const ms = e.ms === null ? "--" : `${e.ms} ms`;
          return (
            <g key={`label-${e.a}-${e.b}`} transform={`translate(${(a.x + b.x) / 2} ${(a.y + b.y) / 2})`} aria-hidden>
              {size.edge === "full" ? (
                <>
                  <rect x={-46} y={-19} width={92} height={36} fill="var(--color-bg)" />
                  <text textAnchor="middle" y={-3} className="fill-fg font-mono text-[14px] font-semibold">
                    {ms}
                  </text>
                  <text textAnchor="middle" y={12} className={relay ? "fill-warn font-mono text-[10px]" : "fill-fg font-mono text-[10px]"}>
                    {relay ? `derp ${e.region ?? ""}` : "direct"}
                  </text>
                </>
              ) : (
                <>
                  <rect x={-24} y={-8} width={48} height={16} fill="var(--color-bg)" />
                  <text textAnchor="middle" y={4} className={relay ? "fill-warn font-mono text-[10px]" : "fill-fg font-mono text-[10px]"}>
                    {ms}
                  </text>
                </>
              )}
            </g>
          );
        })}
        {model.nodes.map(m => {
          const p = at(m.name);
          const off = m.kind === "offline";
          const above = p.y < H / 2;
          return (
            <g
              key={m.name}
              role="link"
              tabIndex={0}
              aria-label={`open ${m.name}`}
              data-machine={m.name}
              onClick={() => open(m.name)}
              onKeyDown={e => {
                if (e.key !== "Enter" && e.key !== " ") return;
                e.preventDefault();
                open(m.name);
              }}
              onMouseEnter={() => setFocus(m.name)}
              onMouseLeave={() => setFocus(null)}
              onFocus={() => setFocus(m.name)}
              onBlur={() => setFocus(null)}
              className="group cursor-pointer outline-none"
              opacity={off ? 0.5 : 1}
            >
              <title>{m.name}</title>
              {m.kind === "no-agent" && <circle cx={p.x} cy={p.y} r={size.halo} fill={m.color} opacity={0.14} />}
              <circle cx={p.x} cy={p.y} r={size.halo} fill="transparent" />
              <circle cx={p.x} cy={p.y} r={size.dot} fill={off ? "transparent" : m.color} stroke={m.color} strokeWidth={off ? 1.5 : 0} />
              <text
                x={p.x}
                y={p.y + size.nameAt[above ? "above" : "below"]}
                textAnchor="middle"
                fontSize={size.label}
                className="fill-fg font-dot font-black group-hover:underline group-focus-visible:underline"
              >
                {shortName(m.name)}
              </text>
              <text x={p.x} y={p.y + size.subAt[above ? "above" : "below"]} textAnchor="middle" className={m.hot ? "fill-bad font-mono text-[10px]" : "fill-dim font-mono text-[10px]"}>
                {m.sub}
              </text>
            </g>
          );
        })}
        {size.legend && (
          <g transform="translate(28 32)" className="font-mono text-[11px]">
            <text className="fill-fg">━ direct</text>
            <text y={16} className="fill-warn">
              ━ relayed
            </text>
            <text y={32} className="fill-dim">
              {model.edges.length > EDGE_LABELS_UP_TO ? "hover for latency" : "click to open"}
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}
