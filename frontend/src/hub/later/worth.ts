import { isVerdict, isWorthReason, type LaterItem, type LaterKind, type Verdict, type Worth, type WorthItem, type WorthReason } from "@/shared/later";
import type { Jev, JevQuestion } from "../jev";
import { askInBatches, createRanker, type RankingStore } from "../ranking";

const DAY_MS = 86_400_000;
const TEXT_CHARS = 1500;
const CHAPTERS_SENT = 20;
const WORK_SENT = 20;

export type Judged = { item: LaterItem; content: string | null };
export type CurrentWork = { tickets: string[]; pullRequests: string[] };

const plain = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max)}…` : s);
const daysSince = (at: number, now: number) => Math.max(0, Math.floor((now - at) / DAY_MS));

export function factsOf({ item, content }: Judged, now: number): Record<string, unknown> {
  return {
    title: item.title,
    kind: item.kind,
    format: item.embed.type,
    site: item.site,
    author: item.author,
    minutes: item.lengthSec === null ? null : Math.max(1, Math.round(item.lengthSec / 60)),
    percent_done: Math.round(item.progress * 100),
    days_since_saved: daysSince(item.savedAt, now),
    chapters: item.chapters.slice(0, CHAPTERS_SENT).map(c => c.title),
    text: clip(content ? plain(content) : item.tldr.join(" "), TEXT_CHARS),
  };
}

export function evidenceOf({ item }: Judged, now: number): string[] {
  const saved = daysSince(item.savedAt, now);
  return [
    [item.author, item.site].filter(Boolean).join(" · "),
    item.lengthSec === null ? null : `${Math.max(1, Math.round(item.lengthSec / 60))} min`,
    item.progress > 0 ? `${Math.round(item.progress * 100)}% ${item.kind === "watch" ? "watched" : "read"}` : null,
    saved === 0 ? "saved today" : `saved ${saved}d ago`,
    item.chapters.length ? `${item.chapters.length} chapters` : null,
  ].flatMap(line => line ?? []);
}

const VALUE_LEVELS = [
  "Not worth the time: already known, off topic or overtaken by events",
  "Someday: nice to have, no pull on current work",
  "This week: real value for the engineer's growth or current projects",
  "Today: directly useful to what the engineer is building right now, or too important to miss",
] as const;

const REASONS: Record<WorthReason, string> = {
  "ship now": "Directly usable in the engineer's current tickets or pull requests this week",
  "deep skill": "Builds lasting depth in AI engineering: agents, evals, retrieval, inference, infra",
  landscape: "A new model, release, paper or shift worth knowing about",
  career: "Helps the engineer's career, craft or way of working",
  fun: "Mostly enjoyment or curiosity",
  stale: "Dated, superseded or already common knowledge",
};

const VERDICTS: Record<Verdict, string> = {
  full: "Worth reading or watching in full",
  skim: "Skim it for the key ideas",
  summary: "A short summary captures what matters",
  archive: "Not worth keeping in the queue",
};

export type WorthOptions = { profile: string; batch: number; now: number; work: CurrentWork };

export async function rankWorth(jev: Jev, judged: readonly Judged[], { profile, batch, now, work }: WorthOptions): Promise<{ ranked: WorthItem[]; costUsd: number }> {
  const { results, costUsd } = await askInBatches(jev, judged, batch, {
    state: keyed => ({
      today: new Date(now).toISOString().slice(0, 10),
      engineer: profile,
      current_work: { tickets: work.tickets.slice(0, WORK_SENT), pull_requests: work.pullRequests.slice(0, WORK_SENT) },
      saved_items: keyed.map(({ key, item }) => ({ key, ...factsOf(item, now) })),
    }),
    questions: (key): Record<string, JevQuestion> => ({
      [`value_${key}`]: {
        type: "score",
        instructions: `Value to the engineer of spending time on saved item ${key} now, given their profile and current work. Weigh relevance, depth, freshness, length and whether it is already started.`,
        criteria: VALUE_LEVELS,
      },
      [`why_${key}`]: { type: "choice", instructions: `The main reason saved item ${key} is or is not worth the engineer's time.`, criteria: REASONS },
      [`verdict_${key}`]: { type: "choice", instructions: `How much of saved item ${key} the engineer should consume.`, criteria: VERDICTS },
    }),
    read: (answers, { key, item }): WorthItem | null => {
      const value = answers[`value_${key}`];
      const why = answers[`why_${key}`];
      const verdict = answers[`verdict_${key}`];
      if (value?.type !== "score" || why?.type !== "choice" || verdict?.type !== "choice" || !isWorthReason(why.choice) || !isVerdict(verdict.choice)) return null;
      return { id: item.item.id, title: item.item.title, score: value.score, reason: why.choice, verdict: verdict.choice, evidence: evidenceOf(item, now) };
    },
  });
  return { ranked: results.toSorted((a, b) => b.score - a.score), costUsd };
}

export type WorthDeps = {
  jev: Jev | null;
  saved: Record<LaterKind, RankingStore<WorthItem>>;
  open: (kind: LaterKind) => Judged[];
  judged: (verdicts: ReadonlyMap<string, Worth>) => void;
  work: () => Promise<CurrentWork>;
  profile: string;
  batch: number;
  shown: number;
};

export function createWorth(deps: WorthDeps) {
  const judge = async (jev: Jev, items: readonly Judged[]) => {
    const out = await rankWorth(jev, items, { profile: deps.profile, batch: deps.batch, now: Date.now(), work: await deps.work() });
    deps.judged(new Map(out.ranked.map(r => [r.id, r.verdict])));
    return out;
  };

  const rankerFor = (kind: LaterKind) =>
    createRanker<WorthItem>({
      jev: deps.jev,
      missingJev: "set OPENROUTER_API_KEY on the hub to rank what is worth your time",
      saved: deps.saved[kind],
      live: async () => new Set(deps.open(kind).map(j => j.item.id)),
      rank: jev => judge(jev, deps.open(kind)),
      keyOf: item => item.id,
      shown: deps.shown,
    });
  const rankers: Record<LaterKind, ReturnType<typeof rankerFor>> = { read: rankerFor("read"), watch: rankerFor("watch") };

  async function scoreSaved(item: LaterItem): Promise<void> {
    const { jev } = deps;
    const judged = deps.open(item.kind).find(j => j.item.id === item.id);
    if (!jev || !judged || judged.item.worth !== "unscored") return;
    await judge(jev, [judged]);
  }

  return { rankers, scoreSaved };
}
