import { describe, expect, test } from "bun:test";
import { notifications, view } from "./fleet.mjs";

/*
 * The bar widget's logic lives in fleet.mjs, a plain ES module the widget's QML
 * imports, so it runs the same here and in Quickshell. QML rendering is not
 * tested. The snapshot is what the widget last fetched: fleet, events and ship
 * badge, each null when that request failed. Limits are the hub's fleet
 * settings, passed in so the widget never hardcodes its own.
 */
const LIMITS = { tempHotC: 70, diskFullPct: 80, loadHotPct: 75 };

type Over = { load?: number; used?: number; temp?: number | null; disks?: { mount: string; used: number; size: number }[]; failed?: string[] };

const live = (name: string, o: Over = {}) => ({
  kind: "live",
  color: "var(--color-machine-1)",
  ts: { id: name, name, os: "linux", ip: "100.64.0.1", version: "1.102.3", online: true, isSelf: false, path: { kind: "direct", addr: "1.2.3.4:41641" }, rxBytes: 0, txBytes: 0, lastSeen: null },
  metrics: {
    at: 1,
    info: { os: "Arch Linux", kernel: "7.2", cpuModel: "i7", threads: 4, memTotal: 16e9, agentVersion: "0.8.0", tailscaleVersion: "1.102.3" },
    uptimeSec: 1,
    cpu: { load: o.load ?? 10, cores: [10, 10, 10, 10], loadAvg: [1, 1, 1] },
    mem: { total: 16e9, used: o.used ?? 8e9, cache: 0, free: 0, swapUsed: 0 },
    disks: o.disks ?? [{ mount: "/", used: 100e9, size: 500e9 }],
    io: { netIn: 0, netOut: 0, diskRead: 0, diskWrite: 0 },
    temp: o.temp === null ? null : { cpu: o.temp ?? 50, max: o.temp ?? 50 },
    battery: null,
    topProcs: [],
    failedServices: o.failed ?? [],
  },
});

const peer = (name: string, kind: "no-agent" | "offline") => ({
  kind,
  color: "var(--color-machine-2)",
  ts: { id: name, name, os: "linux", ip: "100.64.0.9", version: "1.102.3", online: kind !== "offline", isSelf: false, path: { kind: kind === "offline" ? "none" : "direct", addr: "1.2.3.4:41641" }, rxBytes: 0, txBytes: 0, lastSeen: null },
});

const fleetOf = (...machines: unknown[]) => ({ at: 1, tailnet: "tail0000.ts.net", machines, edges: [], latestVersion: null });

type Severity = "bad" | "warn" | "info";
const event = (id: number, severity: Severity, machine = "omarikato", message = `event ${id}`) => ({ id, at: 1_790_000_000_000 + id, machine, severity, message });

const snapshot = (fleet: unknown, events: unknown = [], badge: unknown = { waiting: 0 }) => ({ fleet, events, badge });

describe("the bar item", () => {
  test("shows machines online over total and PRs waiting on review, like 3/4 · 9", () => {
    const fleet = fleetOf(live("archikato"), live("omarikato"), peer("phone", "no-agent"), peer("awsakato", "offline"));
    expect(view(snapshot(fleet, [], { waiting: 9 }), LIMITS).label).toBe("3/4 · 9");
  });

  test("the dot is ok when every machine is healthy", () => {
    expect(view(snapshot(fleetOf(live("archikato"), live("omarikato"))), LIMITS).dot).toBe("ok");
  });

  test("the dot takes the worst machine state: a machine without its agent is warn", () => {
    expect(view(snapshot(fleetOf(live("archikato"), peer("omarikato", "no-agent"))), LIMITS).dot).toBe("warn");
  });

  test("a failed service, a hot machine or a full disk makes the dot bad, even next to a warn", () => {
    const warnToo = peer("phone", "no-agent");
    expect(view(snapshot(fleetOf(live("a"), warnToo, live("b", { failed: ["hermes-gateway"] }))), LIMITS).dot).toBe("bad");
    expect(view(snapshot(fleetOf(live("a"), warnToo, live("b", { temp: 71 }))), LIMITS).dot).toBe("bad");
    expect(view(snapshot(fleetOf(live("a"), warnToo, live("b", { disks: [{ mount: "/", used: 81, size: 100 }] }))), LIMITS).dot).toBe("bad");
  });

  test("the hub's own limits decide: 71°C is fine when the hub says hot starts at 90", () => {
    expect(view(snapshot(fleetOf(live("a", { temp: 71 }))), { ...LIMITS, tempHotC: 90 }).dot).toBe("ok");
  });

  test("when the hub is unreachable the dot is grey and the label is --", () => {
    const v = view(snapshot(null, null, null), LIMITS);
    expect(v.dot).toBe("unreachable");
    expect(v.label).toBe("--");
  });
});

describe("the hover popup", () => {
  const fleet = fleetOf(
    live("archikato", { load: 12, used: 11.36e9, temp: 54, disks: [{ mount: "/", used: 62, size: 100 }] }),
    live("omarikato", { load: 90, used: 6.08e9, temp: 81, disks: [{ mount: "/", used: 30, size: 100 }, { mount: "/home", used: 95, size: 100 }] }),
    live("macato", { temp: null, disks: [] }),
    peer("awsakato", "offline"),
  );
  const v = view(snapshot(fleet), LIMITS);
  const row = (name: string) => {
    const r = v.rows.find((x: { machine: string }) => x.machine === name);
    if (!r) throw new Error(`no popup row for ${name}`);
    return r;
  };
  const cell = (c: { value: number; tone: string } | null) => (c === null ? null : [Math.round(c.value), c.tone]);

  test("has one row per reporting machine with cpu, memory, temperature and fullest disk as numbers", () => {
    const r = row("archikato");
    expect([cell(r.cpu), cell(r.mem), cell(r.temp), cell(r.disk)]).toEqual([
      [12, "ok"],
      [71, "ok"],
      [54, "ok"],
      [62, "ok"],
    ]);
  });

  test("the disk column is the fullest disk, and a value past its limit is colored bad", () => {
    const r = row("omarikato");
    expect(cell(r.disk)).toEqual([95, "bad"]);
    expect(cell(r.temp)).toEqual([81, "bad"]);
    expect(cell(r.cpu)).toEqual([90, "bad"]);
    expect(cell(r.mem)).toEqual([38, "ok"]);
  });

  test("a machine with no temperature sensor or no disks shows no value there rather than a zero", () => {
    const r = row("macato");
    expect(r.temp).toBeNull();
    expect(r.disk).toBeNull();
  });

  test("lists the last 3 events, newest first", () => {
    const events = [event(9, "bad"), event(8, "warn"), event(7, "info"), event(6, "bad"), event(5, "info")];
    expect(view(snapshot(fleet, events), LIMITS).events.map((e: { id: number }) => e.id)).toEqual([9, 8, 7]);
  });

  test("says the hub is unreachable instead of showing stale rows", () => {
    const off = view(snapshot(null, null, null), LIMITS);
    expect(off.unreachable).toBe(true);
    expect(off.rows).toEqual([]);
    expect(v.unreachable).toBe(false);
  });
});

describe("notifications", () => {
  type Notice = { urgency: string; machine: string; title: string; body: string; command: string[] };
  const text = (n: Notice) => `${n.title} ${n.body}`;

  test("the first poll after start only records a baseline, so a restart never replays alerts", () => {
    const first = notifications(null, [event(12, "bad"), event(11, "bad")]);
    expect(first.notify).toEqual([]);
    expect(notifications(first.lastSeenId, [event(12, "bad"), event(11, "bad")]).notify).toEqual([]);
  });

  test("a first poll with no events yet still counts as the baseline, so the next bad event notifies", () => {
    const first = notifications(null, []);
    expect(first.notify).toEqual([]);
    expect(notifications(first.lastSeenId, [event(1, "bad")]).notify).toHaveLength(1);
  });

  test("a failed poll changes nothing, and the first successful one is the baseline", () => {
    const failed = notifications(null, null);
    expect(failed.notify).toEqual([]);
    const baseline = notifications(failed.lastSeenId, [event(3, "bad")]);
    expect(baseline.notify).toEqual([]);
    const later = notifications(baseline.lastSeenId, null);
    expect(later.notify).toEqual([]);
    expect(notifications(later.lastSeenId, [event(4, "bad"), event(3, "bad")]).notify.map((n: Notice) => text(n).includes("event 4"))).toEqual([true]);
  });

  test("only bad events newer than the last seen id notify, at critical urgency", () => {
    const { lastSeenId } = notifications(null, [event(10, "bad")]);
    const next = notifications(lastSeenId, [event(14, "info"), event(13, "bad", "archikato", "hermes-gateway failed on archikato"), event(12, "warn"), event(11, "bad", "omarikato", "omarikato temp crossed 80°C"), event(10, "bad")]);
    expect(next.notify.map((n: Notice) => [n.machine, n.urgency]).sort()).toEqual([
      ["archikato", "critical"],
      ["omarikato", "critical"],
    ]);
    expect(next.notify.some((n: Notice) => text(n).includes("hermes-gateway failed on archikato"))).toBe(true);
    expect(next.notify.some((n: Notice) => text(n).includes("omarikato temp crossed 80°C"))).toBe(true);
  });

  test("warn and info events move the last seen id without notifying, so they are never sent later", () => {
    const { lastSeenId } = notifications(null, [event(20, "bad")]);
    const quiet = notifications(lastSeenId, [event(22, "info"), event(21, "warn"), event(20, "bad")]);
    expect(quiet.notify).toEqual([]);
    expect(notifications(quiet.lastSeenId, [event(22, "info"), event(21, "warn"), event(20, "bad")]).notify).toEqual([]);
  });

  test("clicking a notification opens the Desktop app on that machine through mirai-desktop-open", () => {
    const { lastSeenId } = notifications(null, []);
    const [n] = notifications(lastSeenId, [event(1, "bad", "omarikato", "omarikato disk at 91%")]).notify;
    expect(n?.command).toEqual(["mirai-desktop-open", "/machines/omarikato"]);
  });
});
