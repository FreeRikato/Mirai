import { expect, test } from "bun:test";
import { createProjects } from "./service";

const good = { at: 5, root: "/r", worktrees: [], listeners: [], links: [], containers: [] };

test("each live agent reports its snapshot, failures keep the last good one with a readable reason, and gone agents drop out", async () => {
  let targets = [
    { name: "archikato", url: "http://a" },
    { name: "omarikato", url: "http://o" },
  ];
  let oldAgent = false;
  const service = createProjects({
    targets: () => targets,
    pollMs: 1000,
    idleMs: 120_000,
    linkMemoryMs: 60_000,
    fetchJson: async url => {
      if (url === "http://o/projects" && oldAgent) throw new Error("http://o/projects answered 404");
      return url === "http://a/projects" ? good : { ...good, at: 6 };
    },
  });
  await service.poll();
  expect(service.report().hosts.map(h => [h.host, h.snapshot?.at, h.error])).toEqual([
    ["archikato", 5, null],
    ["omarikato", 6, null],
  ]);
  oldAgent = true;
  await service.poll();
  expect(service.report().hosts[1]).toMatchObject({ snapshot: { at: 6 }, error: "this agent is too old to report projects; update it" });
  targets = [{ name: "archikato", url: "http://a" }];
  await service.poll();
  expect(service.report().hosts.map(h => h.host)).toEqual(["archikato"]);
});

test("a connection seen once is remembered while its process lives, until it goes quiet for longer than the memory", async () => {
  let clock = 0;
  let snap = { ...good, listeners: [{ port: 20103, bind: "*", pid: 11, process: "node", command: "node", cwd: "/r/x", memBytes: 1 }], links: [{ pid: 11, port: 20182 }] };
  const service = createProjects({ targets: () => [{ name: "a", url: "http://a" }], pollMs: 1000, idleMs: 120_000, linkMemoryMs: 60_000, now: () => clock, fetchJson: async () => snap });
  const links = async () => {
    await service.poll();
    return service.report().hosts[0]?.snapshot?.links;
  };
  expect(await links()).toEqual([{ pid: 11, port: 20182 }]);
  snap = { ...snap, links: [] };
  clock = 30_000;
  expect(await links()).toEqual([{ pid: 11, port: 20182 }]);
  clock = 61_000;
  expect(await links()).toEqual([]);
  snap = { ...snap, links: [{ pid: 11, port: 20182 }] };
  expect(await links()).toEqual([{ pid: 11, port: 20182 }]);
  snap = { ...snap, listeners: [], links: [] };
  expect(await links()).toEqual([]);
});

test("agents are only polled while someone has projects open, and the first look after a quiet spell waits for fresh data", async () => {
  let clock = 1_000_000;
  const asked: string[] = [];
  const service = createProjects({
    targets: () => [{ name: "archikato", url: "http://a" }],
    pollMs: 10_000,
    idleMs: 120_000,
    linkMemoryMs: 60_000,
    now: () => clock,
    fetchJson: async url => {
      asked.push(url);
      return { ...good, at: clock };
    },
  });
  await service.tick();
  expect(asked).toHaveLength(0);
  const first = await service.fresh();
  expect(asked).toHaveLength(1);
  expect(first.hosts[0]?.snapshot?.at).toBe(1_000_000);
  clock += 10_000;
  await service.tick();
  expect(asked).toHaveLength(2);
  await service.fresh();
  expect(asked).toHaveLength(2);
  clock += 120_000;
  await service.tick();
  expect(asked).toHaveLength(2);
});
