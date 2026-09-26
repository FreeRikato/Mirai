import type { Page } from "@playwright/test";
import { ClientMessageSchema, type Fleet, type FleetEvent, type HostDetail, type Machine, type Metrics, type ServerMessage } from "../src/shared/schema";
import type { ShipPr } from "../src/shared/ship";
import type { MiraiEvent, MiraiStatus, Thread, ThreadSummary, Turn } from "../src/shared/mirai";

const metrics = (over: Partial<Metrics>): Metrics => ({
  at: Date.now(),
  info: { os: "Arch Linux", kernel: "7.1", cpuModel: "Intel i7", threads: 4, memTotal: 16e9, agentVersion: "0.1.0", tailscaleVersion: "1.102.3" },
  uptimeSec: 86400,
  cpu: { load: 20, cores: [10, 20, 30, 40], loadAvg: [1, 1, 1] },
  mem: { total: 16e9, used: 8e9, cache: 4e9, free: 4e9, swapUsed: 0 },
  disks: [{ mount: "/", used: 100e9, size: 500e9 }],
  io: { netIn: 1000, netOut: 500, diskRead: 0, diskWrite: 0 },
  temp: { cpu: 50, max: 55 },
  battery: { percent: 90, charging: false, onAc: true, cycles: 100, healthPct: 95 },
  topProcs: [{ name: "node", cpu: 12 }],
  failedServices: [],
  ...over,
});

const ts = (name: string, ip: string, isSelf = false, online = true) => ({
  id: name,
  name,
  os: "linux",
  ip,
  version: "1.102.3",
  online,
  isSelf,
  path: isSelf ? ({ kind: "self" } as const) : online ? ({ kind: "direct", addr: "192.168.1.2:41641" } as const) : ({ kind: "none" } as const),
  rxBytes: 1e6,
  txBytes: 1e6,
  lastSeen: online ? null : new Date(Date.now() - 3 * 3600_000).toISOString(),
});

const machines: Machine[] = [
  { kind: "live", color: "#6FD3FF", ts: ts("macato", "100.64.0.10", true), metrics: metrics({}) },
  { kind: "live", color: "#E07BD8", ts: ts("archikato", "100.64.0.20"), metrics: metrics({}) },
  { kind: "offline", color: "#7FA7FF", ts: ts("awsakato", "100.120.61.18", false, false) },
  { kind: "live", color: "#4FC8B8", ts: ts("omarikato", "100.64.26.46"), metrics: metrics({ temp: { cpu: 84, max: 90 }, failedServices: ["hermes-gateway"] }) },
];

export const fleet: Fleet = {
  at: Date.now(),
  tailnet: "tail0000.ts.net",
  machines,
  edges: [
    { a: "macato", b: "omarikato", via: "direct", region: null, ms: 5 },
    { a: "archikato", b: "macato", via: "relay", region: "sin", ms: 61 },
    { a: "archikato", b: "omarikato", via: "direct", region: null, ms: 4 },
  ],
  latestVersion: "1.102.3",
};

export const events: FleetEvent[] = [{ id: 1, at: Date.now(), machine: "omarikato", severity: "bad", message: "omarikato temp crossed 80°C" }];

export const omarikatoDetail: HostDetail = {
  at: Date.now(),
  processes: [
    { pid: 48213, name: "node", command: "node apps/api", user: "omarikato", cpu: 142.3, memBytes: 3e9, started: "2026-09-23 09:12:00" },
    ...Array.from({ length: 24 }, (_, i) => ({ pid: 50000 + i, name: `worker-${i}`, command: `worker --id ${i}`, user: "omarikato", cpu: 24 - i, memBytes: 1e8, started: "2026-09-23 09:12:00" })),
  ],
  ports: [{ port: 5437, proto: "tcp", bind: "127.0.0.1", pid: 48501, process: "postgres" }],
  services: [{ name: "hermes-gateway", kind: "systemd", state: "failed", detail: "failed, exit-code", since: null, restarts: 5, ports: "" }],
};

export async function mockHub(page: Page) {
  await page.route("**/api/fleet", r => r.fulfill({ json: fleet }));
  await page.route("**/api/events", r => r.fulfill({ json: events }));
  await page.route("**/api/load?**", r => r.fulfill({ json: { range: "24h", buckets: 96, rows: [] } }));
  await page.route("**/api/host/**", r => r.fulfill({ json: null }));
  await page.routeWebSocket("**/ws", ws => {
    ws.send(JSON.stringify({ type: "fleet", fleet } satisfies ServerMessage));
    ws.onMessage(raw => {
      const msg = ClientMessageSchema.safeParse(JSON.parse(String(raw)));
      if (msg.success && msg.data.host === "omarikato") {
        ws.send(JSON.stringify({ type: "host", name: "omarikato", detail: omarikatoDetail } satisfies ServerMessage));
      }
    });
  });
}

export async function withShipOrg(page: Page, org = "databrainhq") {
  await page.route("**/api/settings", async r => {
    const response = await r.fetch();
    const json: unknown = await response.json();
    await r.fulfill({ response, json: typeof json === "object" && json !== null ? { ...json, ship: { org } } : json });
  });
}

export const shipPr = (over: Partial<ShipPr> & Pick<ShipPr, "id" | "number" | "title">): ShipPr => ({
  repo: "databrainhq/backend",
  url: `https://github.com/databrainhq/backend/pull/${over.number}`,
  body: "",
  author: "me",
  draft: false,
  head: `branch-${over.number}`,
  base: "develop",
  additions: 10,
  deletions: 2,
  changedFiles: 1,
  files: [{ path: "src/index.ts", additions: 10, deletions: 2 }],
  checks: [{ name: "lint", conclusion: "passed", url: null }],
  reviews: [],
  pending: [],
  conflicts: false,
  relation: "author",
  newCommits: 0,
  state: "waiting",
  why: "no reviewer yet",
  createdAt: "2026-09-20T00:00:00Z",
  updatedAt: new Date(Date.now() - 3 * 3600_000).toISOString(),
  ...over,
});

export type MiraiMock = { status?: MiraiStatus; threads?: ThreadSummary[]; thread?: Thread | null; ask?: (body: unknown) => Promise<{ status: number; ndjson?: MiraiEvent[]; error?: string }> };

export const miraiTurn = (over: Partial<Turn> = {}): Turn => ({
  question: "what should I pick up next?",
  view: "tasks / linear",
  askedAt: Date.now() - 60_000,
  tookMs: 5_000,
  thinking: "Linear board, rank by priority.",
  calls: [{ id: "c1", label: "read tasks · linear", change: false, ok: true }],
  answer: "[DB-412](https://linear.app/databrain/issue/DB-412/rls) RLS filter on embeds.",
  status: "done",
  error: null,
  costUsd: 0.02,
  citations: [],
  ...over,
});

export const miraiThread = (over: Partial<Thread> = {}): Thread => {
  const turns = over.turns ?? [miraiTurn()];
  return {
    id: "01a0ddaa-7be7-76ca-83a8-c900b318a9ee",
    title: turns[0]?.question ?? "",
    view: turns[0]?.view ?? "",
    startedAt: turns[0]?.askedAt ?? 0,
    updatedAt: Date.now(),
    questions: turns.length,
    costUsd: turns.reduce((sum, t) => sum + t.costUsd, 0),
    spend: turns.map(t => ({ at: t.askedAt, costUsd: t.costUsd })),
    busy: false,
    ...over,
    turns,
  };
};

export async function mockMirai(page: Page, m: MiraiMock = {}) {
  await page.route("**/api/mirai/status", r => r.fulfill({ json: m.status ?? { kind: "ready", model: "openai/gpt-5.6-luna", thinking: "medium" } }));
  await page.route("**/api/mirai/threads", r => r.fulfill({ json: m.threads ?? [] }));
  await page.route("**/api/mirai/thread?**", r => (m.thread ? r.fulfill({ json: m.thread }) : r.fulfill({ status: 404, json: { error: "no mirAI thread" } })));
  await page.route("**/api/mirai/stop", r => r.fulfill({ json: { ok: true } }));
  await page.route("**/api/mirai/delete", r => r.fulfill({ json: { ok: true } }));
  await page.route("**/api/mirai/ask", async r => {
    const out = m.ask ? await m.ask(r.request().postDataJSON()) : { status: 503, error: "mirAI is off" };
    if (out.ndjson) return r.fulfill({ status: 200, contentType: "application/x-ndjson", body: out.ndjson.map(e => JSON.stringify(e)).join("\n") + "\n" });
    return r.fulfill({ status: out.status, json: { error: out.error ?? "failed" } });
  });
}
