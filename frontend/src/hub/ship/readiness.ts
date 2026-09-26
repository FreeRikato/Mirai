import { isMergeMove, type MergeMove, type ReadinessItem, type ShipPr } from "@/shared/ship";
import type { LinearIssue, LinearSnapshot } from "@/shared/tasks";
import type { Jev, JevQuestion } from "../jev";
import { askInBatches, createRanker, type RankingStore } from "../ranking";
import type { PrContext } from "./github";

const DAY_MS = 86_400_000;
const DESCRIPTION_CHARS = 600;
const COMMENT_CHARS = 300;
const QUOTE_CHARS = 60;
const THREADS_SENT = 5;
const IDLE_DAYS = 7;

const plain = (s: string) =>
  s
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

const trim = (s: string, max: number) => {
  const flat = plain(s);
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
};
const daysBetween = (from: string, now: number) => Math.max(0, Math.floor((now - Date.parse(from)) / DAY_MS));
const refOf = (pr: Pick<ShipPr, "repo" | "number">) => `${pr.repo.split("/")[1] ?? pr.repo}#${pr.number}`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function linkedTicket(pr: ShipPr, issues: readonly LinearIssue[]): LinearIssue | undefined {
  const linked = issues.find(i => i.links.some(l => l.kind === "pr" && l.repo === pr.repo && l.number === pr.number));
  if (linked) return linked;
  const text = `${pr.title} ${pr.head} ${pr.body}`.toUpperCase();
  return issues.find(i => new RegExp(`\\b${i.identifier}\\b`).test(text));
}

export type Stack = { on: string | null; baseOf: string[] };

export function stackOf(pr: ShipPr, mine: readonly ShipPr[]): Stack {
  const sameRepo = mine.filter(p => p.repo === pr.repo && p.id !== pr.id);
  const below = sameRepo.find(p => p.head === pr.base);
  return { on: below ? refOf(below) : null, baseOf: sameRepo.filter(p => p.base === pr.head).map(refOf) };
}

export type Context = { pr: ShipPr; ctx: PrContext | undefined; ticket: LinearIssue | undefined; stack: Stack };

export function factsOf({ pr, ctx, ticket, stack }: Context, now: number): Record<string, unknown> {
  const checks = (c: ShipPr["checks"][number]["conclusion"]) => pr.checks.filter(x => x.conclusion === c).map(x => x.name);
  return {
    pr: refOf(pr),
    title: pr.title,
    draft: pr.draft,
    ship_state: pr.state,
    ship_state_why: pr.why,
    days_open: daysBetween(pr.createdAt, now),
    days_since_update: daysBetween(pr.updatedAt, now),
    additions: pr.additions,
    deletions: pr.deletions,
    changed_files: pr.changedFiles,
    paths: ctx?.paths ?? pr.files.map(f => f.path),
    description: trim(pr.body, DESCRIPTION_CHARS),
    failing_checks: checks("failed"),
    running_checks: checks("pending"),
    approved_by: pr.reviews.filter(r => r.state === "approved").map(r => r.login),
    changes_requested_by: pr.reviews.filter(r => r.state === "changes").map(r => r.login),
    waiting_on_reviewers: pr.pending,
    conflicts_with_base: pr.conflicts,
    merge_state: ctx?.mergeState ?? "UNKNOWN",
    unresolved_threads: ctx?.unresolved.length ?? 0,
    unresolved_comments: (ctx?.unresolved ?? []).slice(0, THREADS_SENT).flatMap(t => t.map(c => ({ author: c.author, text: trim(c.body, COMMENT_CHARS) }))),
    commits_since_last_review: ctx?.commitsSinceReview ?? null,
    stacked_on: stack.on,
    base_of: stack.baseOf,
    linear_ticket: ticket ? { ticket: ticket.identifier, state: ticket.stateName, priority: ticket.priority, cycle_ends: ticket.cycle?.endsAt.slice(0, 10) ?? null } : null,
  };
}

export function evidenceOf({ pr, ctx, ticket, stack }: Context, now: number): string[] {
  const lastComment = ctx?.unresolved.at(-1)?.findLast(c => plain(c.body));
  const idle = daysBetween(pr.updatedAt, now);
  return [
    pr.why,
    `+${pr.additions} −${pr.deletions} · ${plural(pr.changedFiles, "file")}`,
    ctx?.unresolved.length ? plural(ctx.unresolved.length, "unresolved thread") : null,
    lastComment ? `last: "${trim(lastComment.body, QUOTE_CHARS)}"` : null,
    ctx?.commitsSinceReview ? `${plural(ctx.commitsSinceReview, "commit")} since review` : null,
    ctx?.mergeState === "BEHIND" ? "behind base" : null,
    stack.on ? `stacked on ${stack.on}` : null,
    stack.baseOf.length ? `base of ${stack.baseOf.join(", ")}` : null,
    ticket ? [ticket.identifier, ticket.stateName, ticket.cycle && `cycle ends ${ticket.cycle.endsAt.slice(5, 10)}`].filter(Boolean).join(" · ") : null,
    idle >= IDLE_DAYS ? `idle ${idle}d` : null,
  ].flatMap(line => line ?? []);
}

const READINESS_LEVELS = [
  "Stalled: likely to be closed, split or rethought before it can merge",
  "Needs real work: failing checks, open review feedback or an unfinished draft",
  "One move away: a rebase, a nudge or a small fix, then it can merge",
  "Merge today: approved, green, nothing outstanding",
] as const;

const MOVES: Record<MergeMove, string> = {
  merge: "Approved and green with nothing outstanding, so merge it now",
  "fix ci": "Failing checks are what stands between this and merging",
  "address review": "Requested changes or unresolved review comments need answering",
  rebase: "Behind or conflicting with its base branch",
  "nudge reviewer": "Ready for review but waiting on reviewers, so ping them or find one",
  "finish draft": "Still a draft with work left before review",
  split: "Too large or mixed to review well, so break it into smaller pull requests",
  close: "Stale or superseded, so close it rather than carry it",
};

export async function rankReadiness(jev: Jev, contexts: readonly Context[], { profile, batch, now }: { profile: string; batch: number; now: number }): Promise<{ ranked: ReadinessItem[]; costUsd: number }> {
  const { results, costUsd } = await askInBatches(jev, contexts, batch, {
    state: keyed => ({ today: new Date(now).toISOString().slice(0, 10), engineer: profile, pull_requests: keyed.map(({ key, item }) => ({ key, ...factsOf(item, now) })) }),
    questions: (key): Record<string, JevQuestion> => ({
      [`ready_${key}`]: {
        type: "score",
        instructions: `How close pull request ${key} is to being merged. Weigh checks, reviews, unresolved threads, conflicts, size, age and whether it is still a draft.`,
        criteria: READINESS_LEVELS,
      },
      [`move_${key}`]: { type: "choice", instructions: `The single next move that gets pull request ${key} merged soonest.`, criteria: MOVES },
    }),
    read: (answers, { key, item }): ReadinessItem | null => {
      const ready = answers[`ready_${key}`];
      const move = answers[`move_${key}`];
      if (ready?.type !== "score" || move?.type !== "choice" || !isMergeMove(move.choice)) return null;
      const { pr } = item;
      return { id: pr.id, repo: pr.repo, number: pr.number, title: pr.title, score: ready.score, move: move.choice, evidence: evidenceOf(item, now) };
    },
  });
  return { ranked: results.toSorted((a, b) => b.score - a.score), costUsd };
}

export type ReadinessDeps = {
  jev: Jev | null;
  saved: RankingStore<ReadinessItem>;
  mine: () => Promise<ShipPr[]>;
  contexts: (prs: readonly ShipPr[]) => Promise<Map<string, PrContext>>;
  linear: () => Promise<LinearSnapshot>;
  profile: string;
  batch: number;
  shown: number;
};

export function createMergeReadiness(deps: ReadinessDeps) {
  return createRanker<ReadinessItem>({
    jev: deps.jev,
    missingJev: "set OPENROUTER_API_KEY on the hub to rank merge readiness",
    saved: deps.saved,
    live: async () => new Set((await deps.mine()).map(p => p.id)),
    rank: async jev => {
      const mine = await deps.mine();
      const [ctx, linear] = await Promise.all([deps.contexts(mine), deps.linear()]);
      const issues = linear.kind === "ready" ? linear.issues : [];
      const contexts = mine.map(pr => ({ pr, ctx: ctx.get(pr.id), ticket: linkedTicket(pr, issues), stack: stackOf(pr, mine) }));
      return rankReadiness(jev, contexts, { profile: deps.profile, batch: deps.batch, now: Date.now() });
    },
    keyOf: item => item.id,
    shown: deps.shown,
  });
}
