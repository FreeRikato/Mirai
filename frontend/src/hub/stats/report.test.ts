import { expect, test } from "bun:test";
import type { AgentUsage, UsageRow } from "@/shared/usage";
import { parseRates } from "./pricing";
import { buildReport } from "./report";

const rates = parseRates({
  "claude-opus-5-5": { input_cost_per_token: 1e-6, output_cost_per_token: 1e-5, cache_read_input_token_cost: 1e-7, cache_creation_input_token_cost: 1e-6 },
  "gpt-6-astra": { input_cost_per_token: 2e-6, output_cost_per_token: 2e-5 },
});

const NOW = Date.parse("2026-09-24T12:10:00Z");

const row = (iso: string, over: Partial<UsageRow> = {}): UsageRow => ({ bucket: Date.parse(iso), provider: "claude", model: "claude-opus-5-5", session: "s1", uncached: 1000, cached: 0, cacheWrite: 0, output: 100, ...over });

const usage = (rows: UsageRow[]): AgentUsage => ({ at: NOW, rows });

const report = (machines: Record<string, UsageRow[]>, over: Partial<Parameters<typeof buildReport>[0]> = {}) =>
  buildReport({ usage: new Map(Object.entries(machines).map(([k, v]) => [k, usage(v)])), limits: [], rates, period: "7d", tz: "Asia/Kolkata", hidden: [], now: NOW, ...over });

test("days are local to the viewer: 19:00 UTC is already tomorrow in Kolkata", () => {
  const r = report({ macato: [row("2026-09-22T19:00:00Z"), row("2026-09-22T17:00:00Z")] });
  expect(r.series).toHaveLength(7);
  const byDay = Object.fromEntries(r.heatmap.days.map((d, i) => [d, r.heatmap.claude[i]]));
  expect(byDay["2026-09-22"]).toBe(1100);
  expect(byDay["2026-09-23"]).toBe(1100);
});

test("the 24h view has one point per local hour and drops older rows", () => {
  const r = report({ macato: [row("2026-09-24T11:30:00Z"), row("2026-09-24T12:00:00Z"), row("2026-09-22T12:00:00Z")] }, { period: "24h" });
  expect(r.resolution).toBe("hour");
  expect(r.series.length).toBeGreaterThanOrEqual(24);
  expect(r.totals.tokens).toBe(2200);
  expect(r.series.at(-1)?.claude.tokens).toBe(2200);
});

test("totals price every row, count a session once, and the machine filter narrows everything", () => {
  const machines = {
    macato: [row("2026-09-24T08:00:00Z"), row("2026-09-24T09:00:00Z")],
    archikato: [row("2026-09-24T08:00:00Z", { provider: "codex", model: "gpt-6-astra", session: "c1" }), row("2026-09-24T08:00:00Z", { model: "glm-5.3-flash", session: "g1" })],
  };
  const all = report(machines);
  expect(all.totals.sessions).toBe(3);
  expect(all.totals.costUsd).toBeCloseTo(2 * (0.001 + 0.001) + (0.002 + 0.002), 10);
  expect(all.models.map(m => [m.model, m.priced, m.machines])).toEqual([
    ["claude-opus-5-5", true, ["macato"]],
    ["gpt-6-astra", true, ["archikato"]],
    ["glm-5.3-flash", false, ["archikato"]],
  ]);
  const onlyMac = report(machines, { hidden: ["archikato"] });
  expect(onlyMac.machines.map(m => m.name)).toEqual(["macato"]);
  expect(onlyMac.known).toEqual(["archikato", "macato"]);
  expect(onlyMac.providers.find(p => p.provider === "codex")?.tokens).toBe(0);
});

test("habits find the longest run of active days and the cache hit rate", () => {
  const r = report({ macato: [row("2026-09-20T08:00:00Z"), row("2026-09-21T08:00:00Z"), row("2026-09-22T08:00:00Z", { cached: 3000 }), row("2026-09-24T08:00:00Z")] }, { period: "90d" });
  expect(r.habits.activeDays).toBe(4);
  expect(r.habits.longestStreak).toEqual({ days: 3, from: "2026-09-20", to: "2026-09-22" });
  expect(r.habits.cacheHit).toBeCloseTo(3000 / 7000, 10);
  expect(r.habits.busiestHour?.hour).toBe(13);
});
