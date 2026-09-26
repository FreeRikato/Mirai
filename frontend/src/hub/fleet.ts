import type { AgentTailnet, Edge, Machine, Metrics, Path, TailnetInfo } from "@/shared/schema";
import { ipv4Of, isPC, nameOf, type TailscaleNode, type TailscaleStatus } from "@/shared/tailscale";

export const MACHINE_HUES = 8;
const hue = (i: number) => `var(--color-machine-${i + 1})`;

function hash(s: string): number {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

export function assignColors(names: readonly string[]): Map<string, string> {
  const taken = new Set<number>();
  const out = new Map<string, string>();
  for (const name of [...names].sort()) {
    let i = hash(name) % MACHINE_HUES;
    for (let step = 0; step < MACHINE_HUES && taken.has(i); step++) i = (i + 1) % MACHINE_HUES;
    taken.add(i);
    out.set(name, hue(i));
  }
  return out;
}

export function pathOf(node: TailscaleNode, isSelf: boolean): Path {
  if (isSelf) return { kind: "self" };
  if (!node.Online) return { kind: "none" };
  if (node.CurAddr) return { kind: "direct", addr: node.CurAddr };
  return node.Relay ? { kind: "relay", region: node.Relay } : { kind: "none" };
}

export function tailnetInfos(status: TailscaleStatus): TailnetInfo[] {
  const toInfo = (n: TailscaleNode, isSelf: boolean): TailnetInfo => ({
    id: n.ID,
    name: nameOf(n),
    os: n.OS,
    ip: ipv4Of(n),
    version: isSelf ? (status.Version.split("-")[0] ?? "") : "",
    online: isSelf || Boolean(n.Online),
    isSelf,
    path: pathOf(n, isSelf),
    rxBytes: n.RxBytes ?? 0,
    txBytes: n.TxBytes ?? 0,
    lastSeen: n.LastSeen && !n.LastSeen.startsWith("0001") ? n.LastSeen : null,
  });
  const peers = Object.values(status.Peer ?? {}).filter(isPC).map(n => toInfo(n, false));
  return [toInfo(status.Self, true), ...peers].sort((a, b) => (a.isSelf ? -1 : b.isSelf ? 1 : a.name.localeCompare(b.name)));
}

export type AgentState = { metrics: Metrics | null; failures: number };

export function buildMachines(infos: readonly TailnetInfo[], agents: ReadonlyMap<string, AgentState>, maxFailures: number): Machine[] {
  const colors = assignColors(infos.map(i => i.name));
  return infos.map((ts): Machine => {
    const color = colors.get(ts.name) ?? hue(0);
    const agent = agents.get(ts.name);
    if (agent?.metrics && agent.failures < maxFailures) {
      return { kind: "live", color, ts: { ...ts, online: true, version: agent.metrics.info.tailscaleVersion }, metrics: agent.metrics };
    }
    return ts.online ? { kind: "no-agent", color, ts } : { kind: "offline", color, ts };
  });
}

export function buildEdges(pingsByMachine: ReadonlyMap<string, AgentTailnet>, known: ReadonlySet<string>): Edge[] {
  const edges = new Map<string, Edge>();
  for (const [from, t] of [...pingsByMachine].sort(([a], [b]) => a.localeCompare(b))) {
    if (!known.has(from)) continue;
    for (const p of t.pings) {
      if (!known.has(p.peer)) continue;
      const a = from < p.peer ? from : p.peer;
      const b = a === from ? p.peer : from;
      const key = `${a}|${b}`;
      if (!edges.has(key)) edges.set(key, { a, b, via: p.via, region: p.region, ms: p.ms });
    }
  }
  return [...edges.values()];
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export function latestVersion(versions: readonly string[]): string | null {
  const real = versions.filter(v => /^\d+\.\d+/.test(v));
  return real.length ? real.reduce((m, v) => (compareVersions(v, m) > 0 ? v : m)) : null;
}
