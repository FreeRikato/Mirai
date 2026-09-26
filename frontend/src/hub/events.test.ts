import { expect, test } from "bun:test";
import type { Fleet, Machine, Metrics } from "@/shared/schema";
import { deriveEvents, nextHotLatch, type HotLatch } from "./events";

const LIMITS = { tempHotC: 80, diskFullPct: 85 };

const metrics = (over: Partial<Metrics>): Metrics => ({
  at: 0,
  info: { os: "", kernel: "", cpuModel: "", threads: 1, memTotal: 1, agentVersion: "", tailscaleVersion: "" },
  uptimeSec: 0,
  cpu: { load: 0, cores: [], loadAvg: [0, 0, 0] },
  mem: { total: 1, used: 0, cache: 0, free: 1, swapUsed: 0 },
  disks: [],
  io: { netIn: 0, netOut: 0, diskRead: 0, diskWrite: 0 },
  temp: null,
  battery: null,
  topProcs: [],
  failedServices: [],
  ...over,
});

const ts = (name: string) => ({ id: name, name, os: "linux", ip: "", version: "", online: true, isSelf: false, path: { kind: "none" as const }, rxBytes: 0, txBytes: 0, lastSeen: null });
const live = (name: string, m: Partial<Metrics>): Machine => ({ kind: "live", color: "", ts: ts(name), metrics: metrics(m) });
const fleet = (machines: Machine[], edges: Fleet["edges"] = []): Fleet => ({ at: 0, tailnet: "", machines, edges, latestVersion: null });

test("the first snapshot produces no events", () => {
  expect(deriveEvents(null, fleet([live("omarikato", {})]), LIMITS)).toEqual([]);
});

test("temp and disk thresholds fire once on the way up", () => {
  const hot = { temp: { cpu: 84, max: 90 }, disks: [{ mount: "/", used: 88, size: 100 }] };
  const a = fleet([live("omarikato", { temp: { cpu: 70, max: 70 }, disks: [{ mount: "/", used: 80, size: 100 }] })]);
  const b = fleet([live("omarikato", hot)]);
  expect(deriveEvents(a, b, LIMITS).map(e => e.message)).toEqual(["omarikato temp crossed 80°C", "omarikato disk at 88%"]);
  expect(deriveEvents(b, fleet([live("omarikato", hot)]), LIMITS)).toEqual([]);
});

test("a temperature hovering around the limit reports once until it cools well below it", () => {
  const at = (cpu: number) => fleet([live("archikato", { temp: { cpu, max: cpu } })]);
  const readings = [70, 84, 79, 81, 78, 83, 72, 82];
  let latch: HotLatch = new Set();
  let prev: Fleet | null = null;
  const fired: number[] = [];
  for (const cpu of readings) {
    const next = at(cpu);
    if (deriveEvents(prev, next, LIMITS, latch).length) fired.push(cpu);
    latch = nextHotLatch(next, LIMITS, latch);
    prev = next;
  }
  expect(fired).toEqual([84, 82]);
});

test("going offline, losing the agent, a new failed service and a relay fallback are reported", () => {
  const before = fleet(
    [live("awsakato", {}), live("omarikato", {}), live("archikato", {})],
    [{ a: "archikato", b: "macato", via: "direct", region: null, ms: 10 }],
  );
  const after = fleet(
    [
      { kind: "offline", color: "", ts: ts("awsakato") },
      { kind: "no-agent", color: "", ts: ts("omarikato") },
      live("archikato", { failedServices: ["hermes-gateway"] }),
    ],
    [{ a: "archikato", b: "macato", via: "relay", region: "sin", ms: 61 }],
  );
  expect(deriveEvents(before, after, LIMITS).map(e => e.message)).toEqual([
    "awsakato went offline",
    "omarikato agent stopped answering",
    "hermes-gateway failed on archikato",
    "archikato to macato fell back to derp sin",
  ]);
});
