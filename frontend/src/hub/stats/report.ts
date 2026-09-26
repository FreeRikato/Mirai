import { BUCKET_MS, PROVIDERS, tokenTotal, type AgentUsage, type Habits, type Money, type Period, type Provider, type ReportLimits, type ReportMachine, type ReportModel, type SeriesPoint, type Tokens, type UsageReport, type UsageRow } from "@/shared/usage";
import { costOf, rateFor, savingsOf, type Rate, type RateTable } from "./pricing";

export type Local = { day: string; hour: number; weekday: string };

const DAY_MS = 86_400_000;
const HEATMAP_DAYS = 90;
const PERIOD_DAYS: Record<Exclude<Period, "24h">, number> = { "7d": 7, "30d": 30, "90d": 90 };

const localCache = new Map<string, Map<number, Local>>();

export function localizer(tz: string): (t: number) => Local {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23", weekday: "long" });
  const cache = localCache.get(tz) ?? new Map<number, Local>();
  localCache.set(tz, cache);
  return t => {
    const hit = cache.get(t);
    if (hit) return hit;
    const parts = Object.fromEntries(fmt.formatToParts(t).map(p => [p.type, p.value]));
    const local = { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour), weekday: String(parts.weekday).toLowerCase() };
    cache.set(t, local);
    return local;
  };
}

export const isTimeZone = (tz: string): boolean => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

type Slot = { key: string; start: number };

function slots(now: number, back: number, keyOf: (t: number) => string): Slot[] {
  const last = Math.floor(now / BUCKET_MS) * BUCKET_MS;
  const out: Slot[] = [];
  for (let t = last - back; t <= last; t += BUCKET_MS) {
    const key = keyOf(t);
    if (out.at(-1)?.key !== key) out.push({ key, start: t });
  }
  return out;
}

function lastDays(now: number, n: number, local: (t: number) => Local): Slot[] {
  return slots(now, (n + 1) * DAY_MS, t => local(t).day).slice(-n);
}

const zeroTokens = (): Tokens => ({ uncached: 0, cached: 0, cacheWrite: 0, output: 0 });
const zeroMoney = (): Money => ({ costUsd: 0, tokens: 0 });

const addTokens = (a: Tokens, b: Tokens) => {
  a.uncached += b.uncached;
  a.cached += b.cached;
  a.cacheWrite += b.cacheWrite;
  a.output += b.output;
};

export type ReportInput = {
  usage: ReadonlyMap<string, AgentUsage>;
  limits: ReportLimits[];
  rates: RateTable;
  period: Period;
  tz: string;
  hidden: readonly string[];
  now: number;
};

type Priced = UsageRow & { machine: string; cost: number; tokens: number; savings: number; priced: boolean };

export function buildReport(input: ReportInput): UsageReport {
  const { now, period } = input;
  const local = localizer(input.tz);
  const rateCache = new Map<string, Rate | null>();
  const rate = (model: string) => {
    if (!rateCache.has(model)) rateCache.set(model, rateFor(input.rates, model));
    return rateCache.get(model) ?? null;
  };

  const selected = [...input.usage].filter(([name]) => !input.hidden.includes(name));
  const rows: Priced[] = selected.flatMap(([machine, u]) =>
    u.rows.map(r => {
      const rt = rate(r.model);
      return { ...r, machine, tokens: tokenTotal(r), cost: rt ? costOf(rt, r) : 0, savings: rt ? savingsOf(rt, r) : 0, priced: rt !== null };
    }),
  );

  const resolution = period === "24h" ? "hour" : "day";
  const periodSlots = period === "24h" ? slots(now, DAY_MS - BUCKET_MS, t => `${local(t).day} ${local(t).hour}`) : lastDays(now, PERIOD_DAYS[period], local);
  const from = periodSlots[0]?.start ?? now;
  const inPeriod = rows.filter(r => r.bucket >= from);
  const slotKey = (t: number) => (period === "24h" ? `${local(t).day} ${local(t).hour}` : local(t).day);

  const tokens = zeroTokens();
  const sessions = new Set<string>();
  let costUsd = 0;
  let cacheSavingsUsd = 0;
  const providers = new Map<Provider, Money & { sessions: Set<string> }>(PROVIDERS.map(p => [p, { ...zeroMoney(), sessions: new Set<string>() }]));
  const machines = new Map<string, Money & { sessions: Set<string> }>(selected.map(([name]) => [name, { ...zeroMoney(), sessions: new Set<string>() }]));
  const models = new Map<string, { model: string; provider: Provider; machines: Set<string>; sessions: Set<string>; priced: boolean } & Money>();
  const series = new Map<string, SeriesPoint>(periodSlots.map(s => [s.key, { start: s.start, claude: zeroMoney(), codex: zeroMoney() }]));

  for (const r of inPeriod) {
    const sid = `${r.provider}:${r.session}`;
    addTokens(tokens, r);
    sessions.add(sid);
    costUsd += r.cost;
    cacheSavingsUsd += r.savings;
    for (const acc of [providers.get(r.provider), machines.get(r.machine)]) {
      if (!acc) continue;
      acc.costUsd += r.cost;
      acc.tokens += r.tokens;
      acc.sessions.add(sid);
    }
    const mk = `${r.provider}:${r.model}`;
    const m = models.get(mk) ?? { model: r.model, provider: r.provider, machines: new Set<string>(), sessions: new Set<string>(), priced: r.priced, ...zeroMoney() };
    m.machines.add(r.machine);
    m.sessions.add(sid);
    m.costUsd += r.cost;
    m.tokens += r.tokens;
    models.set(mk, m);
    const point = series.get(slotKey(r.bucket));
    if (point) {
      point[r.provider].costUsd += r.cost;
      point[r.provider].tokens += r.tokens;
    }
  }

  const syncedAt = new Map(selected.map(([name, u]) => [name, u.at]));
  const byMoney = <T extends Money>(a: T, b: T) => b.costUsd - a.costUsd || b.tokens - a.tokens;

  return {
    at: now,
    period,
    resolution,
    known: [...input.usage.keys()].sort(),
    totals: { costUsd, tokens: tokenTotal(tokens), ...tokens, sessions: sessions.size, cacheSavingsUsd },
    providers: [...providers].map(([provider, p]) => ({ provider, costUsd: p.costUsd, tokens: p.tokens, sessions: p.sessions.size })),
    machines: [...machines]
      .map(([name, m]): ReportMachine => ({ name, costUsd: m.costUsd, tokens: m.tokens, sessions: m.sessions.size, syncedAt: syncedAt.get(name) ?? null }))
      .sort(byMoney),
    series: [...series.values()],
    models: [...models.values()]
      .map((m): ReportModel => ({ model: m.model, provider: m.provider, machines: [...m.machines].sort(), sessions: m.sessions.size, costUsd: m.costUsd, tokens: m.tokens, priced: m.priced }))
      .sort(byMoney),
    ...heatmapAndHabits(rows, now, local),
    limits: input.limits,
  };
}

function heatmapAndHabits(rows: readonly Priced[], now: number, local: (t: number) => Local): { heatmap: UsageReport["heatmap"]; habits: Habits } {
  const days = lastDays(now, HEATMAP_DAYS, local);
  const index = new Map(days.map((d, i) => [d.key, i]));
  const claude = days.map(() => 0);
  const codex = days.map(() => 0);
  const hours = Array.from({ length: 24 }, () => 0);
  const weekdayCost = new Map<string, number>();
  const input = zeroTokens();
  const from = days[0]?.start ?? now;

  for (const r of rows) {
    if (r.bucket < from) continue;
    const l = local(r.bucket);
    const i = index.get(l.day);
    if (i === undefined) continue;
    const series = r.provider === "claude" ? claude : codex;
    series[i] = (series[i] ?? 0) + r.tokens;
    hours[l.hour] = (hours[l.hour] ?? 0) + r.tokens;
    weekdayCost.set(l.weekday, (weekdayCost.get(l.weekday) ?? 0) + r.cost);
    addTokens(input, { ...r, output: 0 });
  }

  const active = days.map((_, i) => (claude[i] ?? 0) + (codex[i] ?? 0) > 0);
  let best = { days: 0, from: null as string | null, to: null as string | null };
  let run = 0;
  active.forEach((on, i) => {
    run = on ? run + 1 : 0;
    if (run > best.days) best = { days: run, from: days[i - run + 1]?.key ?? null, to: days[i]?.key ?? null };
  });

  const weekdayCount = new Map<string, number>();
  for (const d of days) {
    const w = local(d.start).weekday;
    weekdayCount.set(w, (weekdayCount.get(w) ?? 0) + 1);
  }
  const weekdays = [...weekdayCost].map(([day, cost]) => ({ day, avgCostUsd: cost / (weekdayCount.get(day) ?? 1) })).sort((a, b) => b.avgCostUsd - a.avgCostUsd);
  const hourTotal = hours.reduce((a, b) => a + b, 0);
  const topHour = hours.reduce((best, v, h) => (v > (hours[best] ?? 0) ? h : best), 0);
  const inputTotal = input.uncached + input.cached + input.cacheWrite;

  return {
    heatmap: { days: days.map(d => d.key), claude, codex },
    habits: {
      activeDays: active.filter(Boolean).length,
      days: days.length,
      longestStreak: best,
      busiestWeekday: weekdays[0] ?? null,
      busiestHour: hourTotal > 0 ? { hour: topHour, share: (hours[topHour] ?? 0) / hourTotal } : null,
      cacheHit: inputTotal > 0 ? input.cached / inputTotal : 0,
    },
  };
}
