import type { Edge, Fleet, Machine } from "@/shared/schema";
import type { Settings } from "@/shared/settings";
import { compareVersions } from "@/hub/fleet";

export type Tone = "bad" | "warn" | "fg" | "dim";
export type Signal = { key: string; machine: string; tone: Tone; text: string };

export const selfOf = (fleet: Fleet): Machine | undefined => fleet.machines.find(m => m.ts.isSelf);

export function edgeTo(fleet: Fleet, name: string): Edge | undefined {
  const self = selfOf(fleet)?.ts.name;
  return fleet.edges.find(e => (e.a === self && e.b === name) || (e.b === self && e.a === name));
}

export const fullestDisk = (m: Machine): number | null =>
  m.kind === "live" && m.metrics.disks.length ? Math.max(...m.metrics.disks.map(d => (d.used / d.size) * 100)) : null;

export const isHot = (m: Machine, tempHotC: number): boolean => m.kind === "live" && (m.metrics.temp?.cpu ?? 0) >= tempHotC;

export const isOutdated = (m: Machine, latest: string | null): boolean =>
  Boolean(latest && m.ts.version && compareVersions(m.ts.version, latest) < 0);

export function signals(fleet: Fleet, limits: Settings["fleet"]): Signal[] {
  const out: Signal[] = [];
  for (const m of fleet.machines) {
    const name = m.ts.name;
    if (m.kind === "no-agent") out.push({ key: `${name}-agent`, machine: name, tone: "warn", text: `${name} no agent` });
    if (m.kind !== "live") continue;
    for (const svc of m.metrics.failedServices) out.push({ key: `${name}-${svc}`, machine: name, tone: "bad", text: `${svc} failed on ${name}` });
    if (isHot(m, limits.tempHotC)) out.push({ key: `${name}-hot`, machine: name, tone: "bad", text: `${name} hot` });
    const disk = fullestDisk(m);
    if (disk !== null && disk >= limits.diskFullPct) out.push({ key: `${name}-disk`, machine: name, tone: "bad", text: `${name} disk ${Math.round(disk)}%` });
  }
  for (const e of fleet.edges) {
    if (e.via !== "relay") continue;
    out.push({ key: `${e.a}-${e.b}-relay`, machine: e.b, tone: "warn", text: `${e.a} to ${e.b} relayed` });
  }
  const rank: Record<Tone, number> = { bad: 0, warn: 1, fg: 2, dim: 3 };
  return out.sort((a, b) => rank[a.tone] - rank[b.tone]);
}

export function pathLabel(fleet: Fleet, m: Machine): { text: string; tone: Tone } {
  if (m.kind === "offline") return { text: "offline", tone: "dim" };
  if (m.ts.path.kind === "self") return { text: "self", tone: "dim" };
  const e = edgeTo(fleet, m.ts.name);
  if (e?.via === "relay" || m.ts.path.kind === "relay") {
    const region = e?.region ?? (m.ts.path.kind === "relay" ? m.ts.path.region : "");
    return { text: `derp ${region}`.trim(), tone: "warn" };
  }
  return { text: "direct", tone: "fg" };
}

export function meshLayout(names: readonly string[], w: number, h: number, sidePad = 120): Map<string, { x: number; y: number }> {
  const cx = w / 2;
  const cy = h / 2;
  const rx = Math.max(0, Math.min(w * 0.34, 330, w / 2 - sidePad));
  const ry = h * 0.32;
  const out = new Map<string, { x: number; y: number }>();
  names.forEach((name, i) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(names.length, 1);
    out.set(name, { x: Math.round(cx + rx * Math.cos(angle)), y: Math.round(cy + ry * Math.sin(angle)) });
  });
  return out;
}
