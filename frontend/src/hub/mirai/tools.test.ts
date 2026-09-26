import { expect, test } from "bun:test";
import type { Fleet } from "@/shared/schema";
import type { ShipPr } from "@/shared/ship";
import type { LinearIssue } from "@/shared/tasks";
import { compact, createMiraiReads, type MiraiSources } from "./tools";

const NOW = Date.parse("2026-09-26T10:00:00Z");

const fleet: Fleet = {
  at: NOW - 5_000,
  tailnet: "t.ts.net",
  edges: [],
  latestVersion: null,
  machines: [
    {
      kind: "live",
      color: "#fff",
      ts: { id: "o", name: "omarikato", os: "linux", ip: "100.64.26.46", version: "1", online: true, isSelf: false, path: { kind: "self" }, rxBytes: 0, txBytes: 0, lastSeen: null },
      metrics: {
        at: NOW - 5_000,
        info: { os: "Arch", kernel: "7", cpuModel: "i7", threads: 8, memTotal: 16e9, agentVersion: "0.5.0", tailscaleVersion: "1" },
        uptimeSec: 7200,
        cpu: { load: 91, cores: [], loadAvg: [11.2, 9, 7] },
        mem: { total: 16e9, used: 14.9e9, cache: 0, free: 1.1e9, swapUsed: 2e9 },
        disks: [{ mount: "/", used: 90e9, size: 100e9 }],
        io: { netIn: 0, netOut: 0, diskRead: 0, diskWrite: 0 },
        temp: { cpu: 84, max: 90 },
        battery: null,
        topProcs: [{ name: "chromium", cpu: 80 }],
        failedServices: [],
      },
    },
    { kind: "offline", color: "#fff", ts: { id: "a", name: "awsakato", os: "linux", ip: "100.1.1.1", version: "1", online: false, isSelf: false, path: { kind: "none" }, rxBytes: 0, txBytes: 0, lastSeen: null } },
  ],
};

const issue = (identifier: string, column: LinearIssue["column"]): LinearIssue => ({
  id: identifier,
  identifier,
  title: `${identifier} title`,
  url: `https://linear.app/databrain/issue/${identifier}`,
  description: "long description ".repeat(50),
  priority: "high",
  column,
  stateName: column === "done" ? "Done" : "Todo",
  team: { id: "t", key: "DB", name: "Databrain" },
  assignee: { name: "Ada", isMe: true },
  creator: null,
  cycle: null,
  links: [],
  updatedAt: "2026-09-26T09:00:00Z",
});

const pr = (number: number): ShipPr => ({
  id: `pr${number}`,
  repo: "databrainhq/backend",
  number,
  title: `PR ${number}`,
  url: `https://github.com/databrainhq/backend/pull/${number}`,
  body: "body ".repeat(500),
  author: "rikato",
  draft: false,
  head: "feat",
  base: "main",
  additions: 10,
  deletions: 2,
  changedFiles: 3,
  files: Array.from({ length: 40 }, (_, i) => ({ path: `src/file${i}.ts`, additions: 1, deletions: 0 })),
  checks: [
    { name: "e2e", conclusion: "failed", url: null },
    { name: "lint", conclusion: "pending", url: null },
  ],
  reviews: [{ login: "jaya", state: "approved" }],
  pending: ["hari"],
  conflicts: false,
  relation: "author",
  newCommits: 0,
  state: "blocked",
  why: "e2e failed",
  createdAt: "2026-09-25T09:00:00Z",
  updatedAt: "2026-09-26T09:00:00Z",
});

const sources = (over: Partial<MiraiSources> = {}): MiraiSources => ({
  fleet: () => fleet,
  events: () => [],
  host: () => null,
  tasks: {
    local: () => ({ kind: "unavailable", reason: "no vault" }),
    linear: async () => ({ kind: "ready", issues: [issue("DB-412", "todo"), issue("DB-400", "done")], fetchedAt: NOW - 60_000 }),
    github: async () => Promise.reject(new Error("GitHub rate limited")),
    priority: async () => ({ kind: "unranked" }),
  },
  ship: async () => ({ kind: "ready", org: "databrainhq", me: "rikato", mine: Array.from({ length: 15 }, (_, i) => pr(i + 1)), review: Array.from({ length: 9 }, (_, i) => pr(100 + i)), fetchedAt: NOW - 30_000 }),
  stats: async () => Promise.reject(new Error("no stats")),
  now: () => NOW,
  ...over,
});

test("the fleet read summarises each machine with its Mirai link and stamps when it was read", () => {
  const out = createMiraiReads(sources()).machines(undefined);
  expect(out.readAt).toBe("2026-09-26T10:00:00.000Z");
  expect(out.data).toEqual(
    expect.objectContaining({
      machines: [
        expect.objectContaining({ name: "omarikato", href: "/machines/omarikato", cpuPct: 91, memFreeGb: 1.1, tempC: 84, fullestDiskPct: 90, uptimeHours: 2 }),
        { name: "awsakato", href: "/machines/awsakato", online: false, state: "offline" },
      ],
    }),
  );
});

test("asking about a machine that is not on the tailnet names the ones that are", () => {
  expect(createMiraiReads(sources()).machines("macbook").data).toEqual({ error: "macbook is not a machine on this tailnet", known: ["omarikato", "awsakato"] });
});

test("tasks read the open work from local, Linear and GitHub by default, and one failing source does not sink the rest", async () => {
  const reads = createMiraiReads(sources());
  expect((await reads.tasks(undefined)).data).toEqual({
    local: { kind: "unavailable", reason: "no vault" },
    linear: {
      fetchedAt: "2026-09-26T09:59:00.000Z",
      open: [{ id: "DB-412", title: "DB-412 title", url: "https://linear.app/databrain/issue/DB-412", priority: "high", state: "Todo", assignee: "me", cycleEndsAt: null, updatedAt: "2026-09-26T09:00:00Z" }],
      doneRecently: 1,
    },
    github: { error: "GitHub rate limited" },
  });
  expect((await reads.tasks("priority")).data).toEqual({ priority: { kind: "unranked" } });
});

test("the ship read keeps every pull request of both queues within the budget, and a queue narrows it", async () => {
  const reads = createMiraiReads(sources());
  const both = compact(await reads.ship(undefined));
  expect(both).not.toContain("(truncated)");
  const parsed: unknown = JSON.parse(both);
  expect(parsed).toEqual(expect.objectContaining({ data: expect.objectContaining({ fetchedAt: "2026-09-26T09:59:30.000Z", mine: expect.any(Array), waitingOnMyReview: expect.any(Array) }) }));
  expect(both.match(/"ref":/g)?.length).toBe(24);
  expect(both).toContain('"failedChecks":["e2e"]');
  expect((await reads.ship("review")).data).not.toHaveProperty("mine");
});

test("a read larger than the budget is cut and marked truncated", () => {
  const out = compact({ items: Array.from({ length: 60 }, () => "x".repeat(400)) });
  expect(out.length).toBe(16_000 + "…(truncated)".length);
  expect(out.endsWith("…(truncated)")).toBe(true);
});

test("compact caps long lists and strings", () => {
  const parsed: unknown = JSON.parse(compact({ items: Array.from({ length: 65 }, (_, i) => i), body: "y".repeat(500) }));
  expect(parsed).toEqual({ items: [...Array.from({ length: 60 }, (_, i) => i), "+5 more"], body: `${"y".repeat(400)}…` });
});
