import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";
import { THINKING_LEVELS } from "@/shared/mirai";
import type { Settings } from "@/shared/settings";

const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const int = (fallback: number) => z.preprocess(blank, z.coerce.number().int().positive().default(fallback));
const optional = z
  .string()
  .optional()
  .transform(v => (v?.trim() ? v.trim() : undefined));

export const EnvSchema = z.object({
  MIRAI_HUB_HOST: z.string().default("127.0.0.1"),
  PORT: int(3131),
  MIRAI_DB: z.string().default("data/mirai.db"),
  TAILSCALE_BIN: z.string().default("tailscale"),
  MIRAI_AGENT_PORT: int(7070),

  MIRAI_VITALS_WATCHED_MS: int(2_000),
  MIRAI_VITALS_IDLE_MS: int(15_000),
  MIRAI_DISCOVERY_WATCHED_MS: int(10_000),
  MIRAI_DISCOVERY_IDLE_MS: int(30_000),
  MIRAI_PINGS_WATCHED_MS: int(30_000),
  MIRAI_PINGS_IDLE_MS: int(300_000),
  MIRAI_DETAIL_MS: int(3_000),
  MIRAI_AGENT_TIMEOUT_MS: int(1_500),
  MIRAI_KILL_TIMEOUT_MS: int(5_000),
  MIRAI_AGENT_MAX_FAILURES: int(3),

  MIRAI_HISTORY_DAYS: int(7),
  MIRAI_EVENT_REPEAT_MS: int(30 * 60_000),
  MIRAI_TEMP_HOT_C: int(80),
  MIRAI_DISK_FULL_PCT: int(85),
  MIRAI_LOAD_HOT_PCT: int(80),
  MIRAI_LIST_PAGE_SIZE: int(10),
  MIRAI_EVENTS_SHOWN: int(12),

  MIRAI_VAULT_DIR: optional,
  MIRAI_CARRY_DAYS: int(7),
  MIRAI_NOTES_SETTLE_MS: int(150),

  LINEAR_API_KEY: optional,
  LINEAR_API_URL: z.string().url().default("https://api.linear.app/graphql"),
  GITHUB_TOKEN: optional,
  GITHUB_GRAPHQL_URL: z.string().url().default("https://api.github.com/graphql"),
  MIRAI_LINEAR_GITHUB_BOT: z.string().default("linear"),
  MIRAI_TASKS_DONE_DAYS: int(14),
  MIRAI_TASKS_POLL_MS: int(60_000),
  MIRAI_TASKS_STALE_AFTER_MS: int(180_000),
  MIRAI_TASKS_CACHE_MS: int(30_000),
  MIRAI_TASKS_CATCHUP_MS: int(3_000),
  MIRAI_TASKS_MAX_PAGES: int(20),
  MIRAI_TASKS_TIMEOUT_MS: int(15_000),

  OPENROUTER_API_KEY: optional,
  OPENROUTER_DECISIONS_URL: z.string().url().default("https://openrouter.ai/api/alpha/decisions"),
  MIRAI_PRIORITY_MODEL: z.string().default("~typesafe/jev-latest"),
  MIRAI_PRIORITY_PROFILE: z.string().default("A software engineer"),
  MIRAI_PRIORITY_BATCH: int(25),
  MIRAI_PRIORITY_SHOWN: int(8),

  MIRAI_SHIP_ORG: optional,
  MIRAI_SHIP_SEARCH_SIZE: int(30),
  MIRAI_SHIP_BODY_REFRESH_MS: int(240_000),

  MIRAI_LATER_WPM: int(230),
  MIRAI_LATER_FETCH_TIMEOUT_MS: int(10_000),
  MIRAI_LATER_STALE_DAYS: int(30),
  MIRAI_LATER_SAVE_EVERY_MS: int(3_000),
  MIRAI_REDDIT_SESSION: optional,
  MIRAI_YTDLP_BIN: z.string().default("yt-dlp"),
  MIRAI_ASR_BIN: optional,
  MIRAI_ASR_POLL_MS: int(30_000),
  MIRAI_ASR_TIMEOUT_MS: int(3_600_000),
  MIRAI_ASR_MAX_ATTEMPTS: int(3),
  MIRAI_ASR_RETRY_MS: int(300_000),

  MIRAI_CODE_DIR: optional,
  MIRAI_CODE_GIT_URL: z.string().url().default("https://github.com"),
  MIRAI_CODE_BIN: optional,
  MIRAI_CODE_TIMEOUT_MS: int(60_000),
  MIRAI_CODE_MAX_BYTES: int(1_000_000),
  MIRAI_PX0_BIN: optional,
  MIRAI_PX0_MAX: int(4),
  MIRAI_PX0_IDLE_MS: int(30 * 60_000),
  MIRAI_PX0_READY_TIMEOUT_MS: int(180_000),

  MIRAI_STATS_DIR: z.string().default("data/stats"),
  MIRAI_STATS_USAGE_POLL_MS: int(300_000),
  MIRAI_STATS_LIMITS_POLL_MS: int(180_000),
  MIRAI_STATS_USAGE_TIMEOUT_MS: int(30_000),
  MIRAI_STATS_LIMITS_TIMEOUT_MS: int(15_000),
  MIRAI_STATS_STALE_ACCOUNT_MS: int(86_400_000),
  MIRAI_PRICES_URL: z.string().url().default("https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json"),
  MIRAI_PRICES_TTL_MS: int(86_400_000),
  MIRAI_PROJECTS_IDLE_MS: int(120_000),
  MIRAI_PROJECTS_FETCH_TIMEOUT_MS: int(12_000),

  OPENAI_API_KEY: optional,
  MIRAI_CHAT_MODEL: z.string().regex(/^openai\/[\w.:-]+$/).default("openai/gpt-6-luna"),
  MIRAI_CHAT_THINKING: z.enum(THINKING_LEVELS).default("medium"),
  MIRAI_CHAT_DIR: z.string().default("data/mirai"),
  MIRAI_CHAT_IDLE_MS: int(600_000),
  MIRAI_WIKI_DIR: optional,
  MIRAI_OWNER: z.string().default("the user"),
});

export function loadConfig(env: Record<string, string | undefined> = process.env) {
  const e = EnvSchema.parse(env);
  const settings: Settings = {
    fleet: { tempHotC: e.MIRAI_TEMP_HOT_C, diskFullPct: e.MIRAI_DISK_FULL_PCT, loadHotPct: e.MIRAI_LOAD_HOT_PCT },
    lists: { pageSize: e.MIRAI_LIST_PAGE_SIZE },
    tasks: { carryDays: e.MIRAI_CARRY_DAYS, pollMs: e.MIRAI_TASKS_POLL_MS, staleAfterMs: e.MIRAI_TASKS_STALE_AFTER_MS, cacheMs: e.MIRAI_TASKS_CACHE_MS, catchUpMs: e.MIRAI_TASKS_CATCHUP_MS, linearGithubBot: e.MIRAI_LINEAR_GITHUB_BOT },
    ship: { org: e.MIRAI_SHIP_ORG ?? null, bodyRefreshMs: e.MIRAI_SHIP_BODY_REFRESH_MS },
    later: { staleDays: e.MIRAI_LATER_STALE_DAYS, saveEveryMs: e.MIRAI_LATER_SAVE_EVERY_MS },
  };
  return {
    server: { host: e.MIRAI_HUB_HOST, port: e.PORT, dbPath: e.MIRAI_DB },
    fleet: {
      tailscaleBin: e.TAILSCALE_BIN,
      agentPort: e.MIRAI_AGENT_PORT,
      every: {
        vitals: { watched: e.MIRAI_VITALS_WATCHED_MS, idle: e.MIRAI_VITALS_IDLE_MS },
        discovery: { watched: e.MIRAI_DISCOVERY_WATCHED_MS, idle: e.MIRAI_DISCOVERY_IDLE_MS },
        pings: { watched: e.MIRAI_PINGS_WATCHED_MS, idle: e.MIRAI_PINGS_IDLE_MS },
        detail: e.MIRAI_DETAIL_MS,
      },
      agentTimeoutMs: e.MIRAI_AGENT_TIMEOUT_MS,
      killTimeoutMs: e.MIRAI_KILL_TIMEOUT_MS,
      maxAgentFailures: e.MIRAI_AGENT_MAX_FAILURES,
      retainMs: e.MIRAI_HISTORY_DAYS * 86_400_000,
      eventRepeatMs: e.MIRAI_EVENT_REPEAT_MS,
      eventsShown: e.MIRAI_EVENTS_SHOWN,
      thresholds: settings.fleet,
    },
    tasks: {
      vaultDir: e.MIRAI_VAULT_DIR,
      carryDays: e.MIRAI_CARRY_DAYS,
      settleMs: e.MIRAI_NOTES_SETTLE_MS,
      remote: { doneDays: e.MIRAI_TASKS_DONE_DAYS, cacheMs: e.MIRAI_TASKS_CACHE_MS, maxPages: e.MIRAI_TASKS_MAX_PAGES, timeoutMs: e.MIRAI_TASKS_TIMEOUT_MS },
      linear: { apiKey: e.LINEAR_API_KEY, url: e.LINEAR_API_URL },
      priority: {
        jev: e.OPENROUTER_API_KEY ? { apiKey: e.OPENROUTER_API_KEY, url: e.OPENROUTER_DECISIONS_URL, model: e.MIRAI_PRIORITY_MODEL, timeoutMs: e.MIRAI_TASKS_TIMEOUT_MS } : null,
        profile: e.MIRAI_PRIORITY_PROFILE,
        batch: e.MIRAI_PRIORITY_BATCH,
        shown: e.MIRAI_PRIORITY_SHOWN,
      },
    },
    github: { token: e.GITHUB_TOKEN, url: e.GITHUB_GRAPHQL_URL, timeoutMs: e.MIRAI_TASKS_TIMEOUT_MS },
    ship: { org: e.MIRAI_SHIP_ORG, searchSize: e.MIRAI_SHIP_SEARCH_SIZE },
    code: {
      dir: e.MIRAI_CODE_DIR ?? join(homedir(), ".cache", "mirai", "code"),
      gitUrl: e.MIRAI_CODE_GIT_URL.replace(/\/$/, ""),
      bin: resolve(e.MIRAI_CODE_BIN ?? join("bin", `mirai-code-${process.platform}-${process.arch}`)),
      timeoutMs: e.MIRAI_CODE_TIMEOUT_MS,
      maxBytes: e.MIRAI_CODE_MAX_BYTES,
    },
    px0: {
      bin: resolve(e.MIRAI_PX0_BIN ?? join("bin", `px0-${process.platform}-${process.arch}`)),
      max: e.MIRAI_PX0_MAX,
      idleMs: e.MIRAI_PX0_IDLE_MS,
      readyTimeoutMs: e.MIRAI_PX0_READY_TIMEOUT_MS,
    },
    later: {
      wpm: e.MIRAI_LATER_WPM,
      fetchTimeoutMs: e.MIRAI_LATER_FETCH_TIMEOUT_MS,
      redditSession: e.MIRAI_REDDIT_SESSION,
      ytdlpBin: e.MIRAI_YTDLP_BIN,
      asr: { bin: e.MIRAI_ASR_BIN, pollMs: e.MIRAI_ASR_POLL_MS, timeoutMs: e.MIRAI_ASR_TIMEOUT_MS, maxAttempts: e.MIRAI_ASR_MAX_ATTEMPTS, retryMs: e.MIRAI_ASR_RETRY_MS },
    },
    notes: { vaultDir: e.MIRAI_VAULT_DIR, settleMs: e.MIRAI_NOTES_SETTLE_MS },
    stats: {
      dir: e.MIRAI_STATS_DIR,
      usagePollMs: e.MIRAI_STATS_USAGE_POLL_MS,
      limitsPollMs: e.MIRAI_STATS_LIMITS_POLL_MS,
      usageTimeoutMs: e.MIRAI_STATS_USAGE_TIMEOUT_MS,
      limitsTimeoutMs: e.MIRAI_STATS_LIMITS_TIMEOUT_MS,
      pricesUrl: e.MIRAI_PRICES_URL,
      pricesTtlMs: e.MIRAI_PRICES_TTL_MS,
      staleAccountMs: e.MIRAI_STATS_STALE_ACCOUNT_MS,
    },
    projects: { idleMs: e.MIRAI_PROJECTS_IDLE_MS, fetchTimeoutMs: e.MIRAI_PROJECTS_FETCH_TIMEOUT_MS },
    mirai: { apiKey: e.OPENAI_API_KEY, model: e.MIRAI_CHAT_MODEL, thinking: e.MIRAI_CHAT_THINKING, dir: resolve(e.MIRAI_CHAT_DIR), idleMs: e.MIRAI_CHAT_IDLE_MS, owner: e.MIRAI_OWNER, wikiDir: e.MIRAI_WIKI_DIR ?? join(homedir(), "Documents", "llm-wiki") },
    settings,
  };
}

export type Config = ReturnType<typeof loadConfig>;
export type FleetThresholds = Settings["fleet"];
export type RemoteLimits = Config["tasks"]["remote"];
