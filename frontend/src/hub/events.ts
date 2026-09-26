import type { Edge, Fleet, Machine, Severity } from "@/shared/schema";
import type { FleetThresholds } from "./config";

export type NewEvent = { machine: string; severity: Severity; message: string };

const fullestDiskPct = (m: Machine): number | null =>
  m.kind === "live" && m.metrics.disks.length ? Math.max(...m.metrics.disks.map(d => (d.used / d.size) * 100)) : null;

const tempOf = (m: Machine): number | null => (m.kind === "live" ? (m.metrics.temp?.cpu ?? null) : null);

const crossedUp = (before: number | null, after: number | null, limit: number): boolean =>
  after !== null && after >= limit && (before === null || before < limit);

type Limits = Pick<FleetThresholds, "tempHotC" | "diskFullPct">;

export type HotLatch = ReadonlySet<string>;

const TEMP_CLEAR_MARGIN_C = 5;
const DISK_CLEAR_MARGIN_PCT = 2;

const latchKey = (name: string, metric: "temp" | "disk") => `${name}|${metric}`;

export function nextHotLatch(fleet: Fleet, limits: Limits, prev: HotLatch): HotLatch {
  const out = new Set<string>();
  const hold = (key: string, value: number | null, limit: number, margin: number) => {
    if (value === null) return;
    if (value >= limit || (prev.has(key) && value >= limit - margin)) out.add(key);
  };
  for (const m of fleet.machines) {
    hold(latchKey(m.ts.name, "temp"), tempOf(m), limits.tempHotC, TEMP_CLEAR_MARGIN_C);
    hold(latchKey(m.ts.name, "disk"), fullestDiskPct(m), limits.diskFullPct, DISK_CLEAR_MARGIN_PCT);
  }
  return out;
}

export function deriveEvents(prev: Fleet | null, next: Fleet, limits: Limits, latch: HotLatch = new Set()): NewEvent[] {
  if (!prev) return [];
  const out: NewEvent[] = [];
  const before = new Map(prev.machines.map(m => [m.ts.name, m]));

  for (const m of next.machines) {
    const name = m.ts.name;
    const was = before.get(name);
    if (!was) {
      out.push({ machine: name, severity: "info", message: `${name} joined the tailnet` });
      continue;
    }
    if (was.kind !== "offline" && m.kind === "offline") out.push({ machine: name, severity: "warn", message: `${name} went offline` });
    if (was.kind === "offline" && m.kind !== "offline") out.push({ machine: name, severity: "info", message: `${name} came online` });
    if (was.kind === "live" && m.kind === "no-agent") out.push({ machine: name, severity: "warn", message: `${name} agent stopped answering` });

    const t = tempOf(m);
    if (crossedUp(tempOf(was), t, limits.tempHotC) && !latch.has(latchKey(name, "temp"))) out.push({ machine: name, severity: "bad", message: `${name} temp crossed ${limits.tempHotC}°C` });

    const d = fullestDiskPct(m);
    if (crossedUp(fullestDiskPct(was), d, limits.diskFullPct) && !latch.has(latchKey(name, "disk"))) out.push({ machine: name, severity: "bad", message: `${name} disk at ${Math.round(d ?? 0)}%` });

    if (m.kind === "live") {
      const failedBefore = new Set(was.kind === "live" ? was.metrics.failedServices : []);
      for (const svc of m.metrics.failedServices) {
        if (!failedBefore.has(svc) && was.kind === "live") out.push({ machine: name, severity: "bad", message: `${svc} failed on ${name}` });
      }
    }
  }

  const edgeKey = (e: Edge) => `${e.a}|${e.b}`;
  const prevEdges = new Map(prev.edges.map(e => [edgeKey(e), e]));
  for (const e of next.edges) {
    const p = prevEdges.get(edgeKey(e));
    if (!p || p.via === e.via) continue;
    out.push(
      e.via === "relay"
        ? { machine: e.b, severity: "warn", message: `${e.a} to ${e.b} fell back to derp ${e.region ?? ""}`.trim() }
        : { machine: e.b, severity: "info", message: `${e.a} to ${e.b} is direct again` },
    );
  }
  return out;
}
