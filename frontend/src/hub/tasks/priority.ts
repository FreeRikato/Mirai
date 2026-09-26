import { PRIORITY_REASONS, type GithubIssue, type GithubSnapshot, type LinearIssue, type LinearSnapshot, type LocalSnapshot, type LocalTask, type PriorityItem, type PriorityReason, type PrState, type TaskLink, type TaskSource } from "@/shared/tasks";
import type { Jev } from "../jev";
import { askInBatches, createRanker, type RankingStore } from "../ranking";
import { prKey, type PrRef, type PrStates } from "./prStates";

export type Candidate = { source: TaskSource; id: string; ref: string; title: string; facts: Record<string, unknown> };

const DETAIL_CHARS = 600;
const trim = (s: string) => (s.length > DETAIL_CHARS ? `${s.slice(0, DETAIL_CHARS)}…` : s);
const DAY_MS = 86_400_000;
const daysSince = (date: string, today: string) => Math.max(0, Math.round((Date.parse(today) - Date.parse(date.slice(0, 10))) / DAY_MS));

export const shipped = (states: readonly (PrState | undefined)[]) => states.includes("merged") && !states.includes("open");

const prLinks = (links: readonly TaskLink[]): PrRef[] => links.flatMap(l => (l.kind === "pr" ? [{ repo: l.repo, number: l.number }] : []));
const issueKey = (i: { repo: string; number: number }) => `${i.repo}#${i.number}`;

export function prRefsOf(local: readonly LocalTask[], linear: readonly LinearIssue[]): PrRef[] {
  return [...local.filter(t => t.state === "open" || t.state === "doing"), ...linear.filter(i => i.column !== "done")].flatMap(x => prLinks(x.links));
}

export function candidates({ local, linear, github, prs, today }: { local: readonly LocalTask[]; linear: readonly LinearIssue[]; github: readonly GithubIssue[]; prs: ReadonlyMap<string, PrState>; today: string }): Candidate[] {
  const hasShipped = (links: readonly TaskLink[]) => shipped(prLinks(links).map(r => prs.get(prKey(r))));

  const liveLinear = linear.filter(i => i.column !== "done" && !hasShipped(i.links));
  const mirrored = new Set(liveLinear.flatMap(i => i.links.flatMap(l => (l.kind === "issue" ? [issueKey(l)] : []))));
  const liveGithub = github.filter(i => i.column !== "closed" && !shipped(i.pullRequests.map(p => p.state)) && !mirrored.has(issueKey(i)));

  const tracked = new Set([...linear.map(i => i.identifier), ...github.map(issueKey)]);
  const liveLocal = local.filter(
    t => (t.state === "open" || t.state === "doing") && !hasShipped(t.links) && !t.links.some(l => (l.kind === "linear" && tracked.has(l.id)) || (l.kind === "issue" && tracked.has(issueKey(l)))),
  );

  return [
    ...liveLocal.map(t => ({
      source: "local" as const,
      id: t.id,
      ref: t.date,
      title: t.title || "untitled",
      facts: { from: "daily note", state: t.state, written: t.date, days_old: daysSince(t.date, today), subtasks: `${t.subtasks.done}/${t.subtasks.total}`, notes: trim(t.block) },
    })),
    ...liveLinear.map(i => ({
      source: "linear" as const,
      id: i.id,
      ref: i.identifier,
      title: i.title,
      facts: {
        from: "linear",
        ticket: i.identifier,
        state: i.stateName,
        priority: i.priority,
        assigned_to_me: i.assignee?.isMe ?? false,
        created_by_me: i.creator?.isMe ?? false,
        cycle_ends: i.cycle?.endsAt.slice(0, 10) ?? null,
        days_since_update: daysSince(i.updatedAt, today),
        description: trim(i.description),
      },
    })),
    ...liveGithub.map(i => ({
      source: "github" as const,
      id: i.id,
      ref: `${i.repo.split("/")[1] ?? i.repo}#${i.number}`,
      title: i.title,
      facts: {
        from: "github issue",
        issue: issueKey(i),
        labels: i.labels.map(l => l.name),
        assigned_to_me: i.assignedToMe,
        created_by_me: i.createdByMe,
        comments: i.comments,
        open_pull_request: i.pullRequests.some(p => p.state === "open"),
        days_since_update: daysSince(i.updatedAt, today),
        body: trim(i.body),
      },
    })),
  ];
}

const ROI_LEVELS = [
  "Skip or defer: little return, or not really this engineer's to do",
  "Low: fine to leave for later",
  "This week: clear value, not urgent",
  "Today: highest return, urgent, blocking others or nearly done",
] as const;

const REASONS: Record<PriorityReason, string> = {
  customer: "Fixes or ships something customers or users of the product feel directly",
  "in flight": "Already started and close to done, so finishing it frees attention",
  "ai core": "Advances the engineer's main goal as described in the profile",
  unblocks: "Unblocks teammates: reviews, merges or releases others are waiting on",
  hygiene: "Tests, tooling, cleanup or follow-ups that can wait",
};

const isReason = (s: string): s is PriorityReason => PRIORITY_REASONS.some(r => r === s);

export async function rank(jev: Jev, items: readonly Candidate[], { profile, today, batch }: { profile: string; today: string; batch: number }): Promise<{ ranked: PriorityItem[]; costUsd: number }> {
  const { results, costUsd } = await askInBatches(jev, items, batch, {
    state: keyed => ({ today, engineer: profile, items: keyed.map(({ key, item }) => ({ key, title: item.title, ...item.facts })) }),
    questions: key => ({
      [`roi_${key}`]: {
        type: "score",
        instructions: `Return on investment of the engineer working on item ${key} next. Weigh impact on customers and teammates, urgency, whether it is already under way, and effort.`,
        criteria: ROI_LEVELS,
      },
      [`why_${key}`]: { type: "choice", instructions: `The main reason item ${key} is worth the engineer's time.`, criteria: REASONS },
    }),
    read: (answers, { key, item }): PriorityItem | null => {
      const roi = answers[`roi_${key}`];
      const why = answers[`why_${key}`];
      if (roi?.type !== "score" || why?.type !== "choice" || !isReason(why.choice)) return null;
      return { source: item.source, id: item.id, ref: item.ref, title: item.title, score: roi.score, reason: why.choice };
    },
  });
  return { ranked: results.toSorted((a, b) => b.score - a.score), costUsd };
}

export type PriorityDeps = {
  jev: Jev | null;
  saved: RankingStore<PriorityItem>;
  prStates: PrStates;
  local: () => LocalSnapshot;
  linear: () => Promise<LinearSnapshot>;
  github: () => Promise<GithubSnapshot>;
  profile: string;
  batch: number;
  shown: number;
};

const itemKey = (x: { source: TaskSource; id: string }) => `${x.source}:${x.id}`;

export function createPriority(deps: PriorityDeps) {
  async function gather(): Promise<{ items: Candidate[]; today: string }> {
    const local = deps.local();
    const [linear, github] = await Promise.all([deps.linear(), deps.github()]);
    const tasks = local.kind === "ready" ? local.tasks : [];
    const tickets = linear.kind === "ready" ? linear.issues : [];
    const issues = github.kind === "ready" ? github.issues : [];
    const today = local.kind === "ready" ? local.today : new Date().toISOString().slice(0, 10);
    const prs = await deps.prStates(prRefsOf(tasks, tickets)).catch((err: unknown) => {
      console.warn("priority: pull request states unavailable", err instanceof Error ? err.message : err);
      return new Map<string, PrState>();
    });
    return { items: candidates({ local: tasks, linear: tickets, github: issues, prs, today }), today };
  }

  return createRanker({
    jev: deps.jev,
    missingJev: "set OPENROUTER_API_KEY on the hub to rank priorities",
    saved: deps.saved,
    live: async () => new Set((await gather()).items.map(itemKey)),
    rank: async jev => {
      const { items, today } = await gather();
      return rank(jev, items, { profile: deps.profile, today, batch: deps.batch });
    },
    keyOf: itemKey,
    shown: deps.shown,
  });
}
