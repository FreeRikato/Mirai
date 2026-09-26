import { expect, test } from "bun:test";
import type { Fleet, Machine, Metrics } from "@/shared/schema";
import { meshLayout, pathLabel, signals } from "./derive";

const ts = (name: string, isSelf = false) => ({ id: name, name, os: "linux", ip: "", version: "1.102.3", online: true, isSelf, path: isSelf ? ({ kind: "self" } as const) : ({ kind: "direct", addr: "x" } as const), rxBytes: 0, txBytes: 0, lastSeen: null });
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
const live = (name: string, m: Partial<Metrics> = {}, isSelf = false): Machine => ({ kind: "live", color: "", ts: ts(name, isSelf), metrics: metrics(m) });

const fleet: Fleet = {
  at: 0,
  tailnet: "t",
  latestVersion: "1.102.3",
  machines: [
    live("macato", {}, true),
    live("omarikato", { temp: { cpu: 84, max: 90 }, failedServices: ["hermes-gateway"] }),
    live("archikato"),
    { kind: "offline", color: "", ts: ts("awsakato") },
  ],
  edges: [
    { a: "macato", b: "omarikato", via: "direct", region: null, ms: 5 },
    { a: "archikato", b: "macato", via: "relay", region: "sin", ms: 61 },
  ],
};

test("signals list failures and heat before relays, and ignore offline machines", () => {
  expect(signals(fleet, { tempHotC: 80, diskFullPct: 85, loadHotPct: 80 }).map(s => s.text)).toEqual(["hermes-gateway failed on omarikato", "omarikato hot", "archikato to macato relayed"]);
});

test("pathLabel follows the hub-side edge regardless of which side reported it", () => {
  const [self, omar, arch, aws] = fleet.machines;
  if (!self || !omar || !arch || !aws) throw new Error("fixture");
  expect([pathLabel(fleet, self), pathLabel(fleet, omar), pathLabel(fleet, arch), pathLabel(fleet, aws)].map(p => p.text)).toEqual(["self", "direct", "derp sin", "offline"]);
});

test("meshLayout puts the first machine at the top and spreads the rest evenly", () => {
  const pos = meshLayout(["a", "b", "c", "d"], 800, 500);
  expect(pos.get("a")).toEqual({ x: 400, y: 90 });
  expect(pos.get("c")).toEqual({ x: 400, y: 410 });
  expect(pos.get("b")?.x).toBeGreaterThan(400);
  expect(pos.get("d")?.x).toBeLessThan(400);
});
