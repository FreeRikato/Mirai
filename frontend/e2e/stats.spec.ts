import { expect, test, type Page } from "@playwright/test";
import type { UsageReport } from "../src/shared/usage";
import { mockHub, mockMirai } from "./fixtures";

const HOUR = 3_600_000;
const NOW = Date.now();
const money = (costUsd: number, tokens: number) => ({ costUsd, tokens });

const report = (over: Partial<UsageReport> = {}): UsageReport => ({
  at: NOW,
  period: "30d",
  resolution: "day",
  known: ["archikato", "macato", "omarikato"],
  totals: { costUsd: 1284.6, tokens: 1_920_000_000, uncached: 214_000_000, cached: 1_610_000_000, cacheWrite: 0, output: 96_100_000, sessions: 412, cacheSavingsUsd: 2410 },
  providers: [
    { provider: "claude", costUsd: 902.1, tokens: 1_410_000_000, sessions: 300 },
    { provider: "codex", costUsd: 382.5, tokens: 512_000_000, sessions: 112 },
  ],
  machines: [
    { name: "macato", costUsd: 611.2, tokens: 900_000_000, sessions: 168, syncedAt: NOW - 40_000 },
    { name: "archikato", costUsd: 498.9, tokens: 700_000_000, sessions: 171, syncedAt: NOW - 40_000 },
    { name: "omarikato", costUsd: 174.5, tokens: 320_000_000, sessions: 73, syncedAt: NOW - 40_000 },
  ],
  series: Array.from({ length: 30 }, (_, i) => ({ start: NOW - (29 - i) * 24 * HOUR, claude: money(20 + i, 1e7), codex: money(5, 1e6) })),
  models: [
    { model: "claude-opus-5-5", provider: "claude", machines: ["archikato", "macato"], sessions: 184, tokens: 842_000_000, costUsd: 668.3, priced: true },
    { model: "gpt-6-astra", provider: "codex", machines: ["macato"], sessions: 121, tokens: 498_000_000, costUsd: 372.1, priced: true },
    { model: "glm-5.3-flash", provider: "claude", machines: ["omarikato"], sessions: 12, tokens: 9_000_000, costUsd: 0, priced: false },
  ],
  heatmap: { days: Array.from({ length: 90 }, (_, i) => new Date(NOW - (89 - i) * 24 * HOUR).toISOString().slice(0, 10)), claude: Array.from({ length: 90 }, (_, i) => (i % 7) * 1e6), codex: Array.from({ length: 90 }, (_, i) => (i % 3) * 1e6) },
  habits: { activeDays: 71, days: 90, longestStreak: { days: 23, from: "2026-08-18", to: "2026-09-09" }, busiestWeekday: { day: "wednesday", avgCostUsd: 61.2 }, busiestHour: { hour: 15, share: 0.28 }, cacheHit: 0.88 },
  limits: [
    { provider: "claude", source: "archikato", ok: true, account: "a", plan: "max 20x", checkedAt: NOW - 60_000, resetCredits: null, windows: [
      { id: "session", label: "session", usedPercent: 38, resetsAt: NOW + 2 * HOUR, durationMs: 5 * HOUR },
      { id: "weekly_all", label: "weekly", usedPercent: 81, resetsAt: NOW + 78 * HOUR, durationMs: 168 * HOUR },
    ] },
    { provider: "codex", source: "archikato", ok: false, error: "api key login has no plan limits" },
  ],
  ...over,
});

async function mockStats(page: Page) {
  const asked: URL[] = [];
  await mockHub(page);
  await page.route("**/api/stats/ai?**", r => {
    const url = new URL(r.request().url());
    asked.push(url);
    const period = url.searchParams.get("period");
    return r.fulfill({ json: report(period === "24h" ? { period: "24h", resolution: "hour" } : {}) });
  });
  return asked;
}

test("stats shows plan limits with the low one flagged and a missing provider explained", async ({ page }) => {
  await mockStats(page);
  await page.goto("/stats");
  const claude = page.getByRole("region", { name: "Claude Code limits" });
  await expect(claude).toContainText("max 20x");
  await expect(claude.getByText("62% left")).toBeVisible();
  await expect(claude.getByText("19% left")).toHaveClass(/text-bad/);
  await expect(claude.getByRole("img", { name: /^weekly: 19% left/ })).toBeVisible();
  await expect(page.getByRole("region", { name: "Codex limits" })).toContainText("api key login has no plan limits");
  await expect(page.getByText("$1,284.60")).toBeVisible();
  await expect(page.getByRole("row", { name: /glm-5.3-flash/ })).toContainText("unpriced");
  await expect(page.getByRole("img", { name: "Claude Code tokens per day, last 90 days" })).toBeVisible();
});

test("period, metric and machine controls drive the request and survive a reload", async ({ page }) => {
  const asked = await mockStats(page);
  await page.goto("/stats");
  await page.getByRole("radio", { name: "24h" }).click();
  await page.getByRole("radio", { name: "tokens" }).click();
  await page.getByRole("group", { name: "machines" }).getByRole("button", { name: "omarikato" }).click();
  await expect(page.getByRole("heading", { name: "hourly tokens" })).toBeVisible();
  await expect.poll(() => asked.at(-1)?.searchParams.get("hide")).toBe("omarikato");
  expect(asked.at(-1)?.searchParams.get("period")).toBe("24h");
  expect(asked.at(-1)?.searchParams.get("tz")).toBeTruthy();
  await page.reload();
  await expect(page.getByRole("radio", { name: "24h" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("group", { name: "machines" }).getByRole("button", { name: "omarikato" })).toHaveAttribute("aria-pressed", "false");
});

test("on a phone the stats page fits the screen without sideways scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockStats(page);
  await page.goto("/stats");
  await expect(page.getByText("$1,284.60")).toBeVisible();
  const overflow = await page.locator("main").evaluate(m => m.scrollWidth - m.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.screenshot({ path: "test-results/stats-mobile.png", fullPage: true });
});

test("mirAI spend shows as its own line for threads active in the period", async ({ page }) => {
  await mockStats(page);
  const old = NOW - 60 * 86_400_000;
  const thread = (id: string, spend: { at: number; costUsd: number }[]) => ({ id, title: "q", view: "fleet", startedAt: spend[0]?.at ?? NOW, updatedAt: spend.at(-1)?.at ?? NOW, questions: spend.length, costUsd: spend.reduce((s, x) => s + x.costUsd, 0), spend });
  await mockMirai(page, {
    threads: [
      thread("01a0ddaa-0000-7000-8000-000000000001", [
        { at: old, costUsd: 5 },
        { at: NOW - HOUR, costUsd: 0.12 },
      ]),
      thread("01a0ddaa-0000-7000-8000-000000000002", [{ at: old, costUsd: 3 }]),
    ],
  });
  await page.goto("/stats");
  await expect(page.getByText("1 thread · openai api, not in the total")).toBeVisible();
  await expect(page.getByText(/^mirAI\s*\$0\.12$/)).toBeVisible();
});
