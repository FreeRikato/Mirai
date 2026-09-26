import { mkdir } from "node:fs/promises";
import { z } from "zod";
import { AgentLimitsSchema, AgentUsageSchema, PROVIDERS, ProviderSchema, LimitWindowSchema, type AgentUsage, type Period, type ProviderLimits, type ReportLimits, type UsageReport } from "@/shared/usage";
import { createPrices } from "./pricing";
import { buildReport } from "./report";

export type AgentTarget = { name: string; url: string };

export type StatsConfig = {
  dir: string;
  usagePollMs: number;
  limitsPollMs: number;
  usageTimeoutMs: number;
  limitsTimeoutMs: number;
  pricesUrl: string;
  pricesTtlMs: number;
  staleAccountMs: number;
};

const GoodLimitsSchema = z.object({
  ok: z.literal(true),
  provider: ProviderSchema,
  source: z.string(),
  account: z.string(),
  plan: z.string().nullable(),
  checkedAt: z.number(),
  windows: z.array(LimitWindowSchema),
  resetCredits: z.number().nullable(),
});
type GoodLimits = z.infer<typeof GoodLimitsSchema>;

async function getJson(url: string, timeoutMs: number): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res.json();
}

export function pickLimits(good: readonly GoodLimits[], errors: ReadonlyMap<string, { source: string; error: string }>, staleAccountMs: number): ReportLimits[] {
  return PROVIDERS.flatMap((provider): ReportLimits[] => {
    const mine = good.filter(g => g.provider === provider).sort((a, b) => b.checkedAt - a.checkedAt);
    const newest = mine[0]?.checkedAt ?? 0;
    const live = mine.filter(g => newest - g.checkedAt <= staleAccountMs);
    if (live.length) return live;
    const err = errors.get(provider);
    return [{ ok: false, provider, source: err?.source ?? "", error: err?.error ?? "no machine has reported limits yet" }];
  });
}

export function createAiStats(deps: { targets: () => AgentTarget[]; config: StatsConfig }) {
  const { config } = deps;
  const usage = new Map<string, AgentUsage>();
  const good = new Map<string, GoodLimits>();
  const errors = new Map<string, { source: string; error: string }>();
  const prices = createPrices({ url: config.pricesUrl, ttlMs: config.pricesTtlMs, cacheFile: `${config.dir}/prices.json`, timeoutMs: config.usageTimeoutMs });
  const usageFile = (name: string) => `${config.dir}/usage-${encodeURIComponent(name)}.json`;
  const limitsFile = `${config.dir}/limits.json`;

  async function restore() {
    await mkdir(config.dir, { recursive: true });
    for await (const path of new Bun.Glob("usage-*.json").scan({ cwd: config.dir, absolute: true })) {
      const name = decodeURIComponent(path.slice(path.lastIndexOf("/usage-") + 7, -5));
      const parsed = AgentUsageSchema.safeParse(await Bun.file(path).json().catch(() => null));
      if (parsed.success) usage.set(name, parsed.data);
    }
    const saved = z.array(GoodLimitsSchema).safeParse(await Bun.file(limitsFile).json().catch(() => null));
    if (saved.success) for (const g of saved.data) good.set(`${g.provider}:${g.account}`, g);
  }

  async function pollUsage() {
    await Promise.all(
      deps.targets().map(async t => {
        try {
          const u = AgentUsageSchema.parse(await getJson(`${t.url}/usage`, config.usageTimeoutMs));
          usage.set(t.name, u);
          await Bun.write(usageFile(t.name), JSON.stringify(u));
        } catch (err) {
          console.error(`[stats] usage from ${t.name} failed`, err instanceof Error ? err.message : err);
        }
      }),
    );
  }

  async function pollLimits() {
    const replies = await Promise.all(
      deps.targets().map(async t => {
        try {
          return { source: t.name, list: AgentLimitsSchema.parse(await getJson(`${t.url}/limits`, config.limitsTimeoutMs)) };
        } catch {
          return { source: t.name, list: [] as ProviderLimits[] };
        }
      }),
    );
    for (const { source, list } of replies) {
      for (const l of list) {
        if (l.ok) {
          const key = `${l.provider}:${l.account}`;
          if ((good.get(key)?.checkedAt ?? 0) <= l.checkedAt) good.set(key, { ...l, source });
        } else if (!errors.has(l.provider) || !l.error.startsWith("api key")) errors.set(l.provider, { source, error: l.error });
      }
    }
    await Bun.write(limitsFile, JSON.stringify([...good.values()]));
  }

  function every(fn: () => Promise<void>, ms: number, label: string) {
    const loop = async () => {
      try {
        await fn();
      } catch (err) {
        console.error(`[stats] ${label} failed`, err);
      }
      setTimeout(loop, ms);
    };
    return loop;
  }

  return {
    async start() {
      await restore();
      void every(pollUsage, config.usagePollMs, "usage poll")();
      void every(pollLimits, config.limitsPollMs, "limits poll")();
    },
    async refresh() {
      await Promise.all([pollUsage(), pollLimits()]);
    },
    async report(q: { period: Period; tz: string; hidden: readonly string[] }): Promise<UsageReport> {
      return buildReport({ ...q, usage, rates: await prices.table(), limits: pickLimits([...good.values()], errors, config.staleAccountMs), now: Date.now() });
    },
  };
}

export type AiStats = ReturnType<typeof createAiStats>;
