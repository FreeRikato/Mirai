import { z } from "zod";

export const PROVIDERS = ["claude", "codex"] as const;
export type Provider = (typeof PROVIDERS)[number];
export const ProviderSchema = z.enum(PROVIDERS);

export const PERIODS = ["24h", "7d", "30d", "90d"] as const;
export type Period = (typeof PERIODS)[number];
export const isPeriod = (s: unknown): s is Period => PERIODS.some(p => p === s);

export const METRICS = ["cost", "tokens"] as const;
export type Metric = (typeof METRICS)[number];

export const BUCKET_MS = 30 * 60_000;

const count = z.number().int().nonnegative();

export const TokensSchema = z.object({ uncached: count, cached: count, cacheWrite: count, output: count });
export type Tokens = z.infer<typeof TokensSchema>;

export const UsageRowSchema = TokensSchema.extend({ bucket: z.number().int(), provider: ProviderSchema, model: z.string(), session: z.string() });
export type UsageRow = z.infer<typeof UsageRowSchema>;

export const AgentUsageSchema = z.object({ at: z.number(), rows: z.array(UsageRowSchema) });
export type AgentUsage = z.infer<typeof AgentUsageSchema>;

export const LimitWindowSchema = z.object({ id: z.string(), label: z.string(), usedPercent: z.number(), resetsAt: z.number().nullable(), durationMs: z.number().positive() });
export type LimitWindow = z.infer<typeof LimitWindowSchema>;

export const ProviderLimitsSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), provider: ProviderSchema, account: z.string(), plan: z.string().nullable(), checkedAt: z.number(), windows: z.array(LimitWindowSchema), resetCredits: z.number().int().nonnegative().nullable() }),
  z.object({ ok: z.literal(false), provider: ProviderSchema, error: z.string() }),
]);
export type ProviderLimits = z.infer<typeof ProviderLimitsSchema>;
export type LiveLimits = Extract<ProviderLimits, { ok: true }>;

export const AgentLimitsSchema = z.array(ProviderLimitsSchema);

export const tokenTotal = (t: Tokens): number => t.uncached + t.cached + t.cacheWrite + t.output;

export type Money = { costUsd: number; tokens: number };

export type ReportLimits = { provider: Provider; source: string } & ({ ok: true; account: string; plan: string | null; checkedAt: number; windows: LimitWindow[]; resetCredits: number | null } | { ok: false; error: string });

export type ReportMachine = Money & { name: string; sessions: number; syncedAt: number | null };

export type ReportModel = Money & { model: string; provider: Provider; machines: string[]; sessions: number; priced: boolean };

export type SeriesPoint = { start: number; claude: Money; codex: Money };

export type Habits = {
  activeDays: number;
  days: number;
  longestStreak: { days: number; from: string | null; to: string | null };
  busiestWeekday: { day: string; avgCostUsd: number } | null;
  busiestHour: { hour: number; share: number } | null;
  cacheHit: number;
};

export type UsageReport = {
  at: number;
  period: Period;
  resolution: "hour" | "day";
  known: string[];
  totals: Money & Tokens & { sessions: number; cacheSavingsUsd: number };
  providers: (Money & { provider: Provider; sessions: number })[];
  machines: ReportMachine[];
  series: SeriesPoint[];
  models: ReportModel[];
  heatmap: { days: string[]; claude: number[]; codex: number[] };
  habits: Habits;
  limits: ReportLimits[];
};
