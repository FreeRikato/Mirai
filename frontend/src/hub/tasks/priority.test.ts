import { expect, test } from "bun:test";
import { PriorityItemSchema, type GithubIssue, type LinearIssue, type LocalTask, type PriorityItem, type PrState, type TaskLink } from "@/shared/tasks";
import { openDb } from "../db";
import type { Jev } from "../jev";
import { candidates, createPriority, rank, type Candidate } from "./priority";
import { createRankingStore, RANKING_ROWS, type RankingStore } from "../ranking";

const TODAY = "2026-09-24";
const pr = (number: number): TaskLink => ({ kind: "pr", url: `https://github.com/databrainhq/backend/pull/${number}`, repo: "databrainhq/backend", number });

const note = (line: number, over: Partial<LocalTask> = {}): LocalTask => ({
  id: `2026-09-23:${line}`,
  date: "2026-09-23",
  line,
  state: "open",
  title: `note ${line}`,
  raw: "",
  links: [],
  subtasks: { done: 0, total: 0 },
  block: "",
  ...over,
});

const ticket = (identifier: string, over: Partial<LinearIssue> = {}): LinearIssue => ({
  id: identifier,
  identifier,
  title: identifier,
  url: `https://linear.app/x/issue/${identifier}`,
  description: "",
  priority: "none",
  column: "todo",
  stateName: "Todo",
  team: { id: "t", key: "DEV", name: "Dev" },
  assignee: { name: "me", isMe: true },
  creator: null,
  cycle: null,
  links: [],
  updatedAt: "2026-09-23T00:00:00Z",
  ...over,
});

const issue = (number: number, over: Partial<GithubIssue> = {}): GithubIssue => ({
  id: `I${number}`,
  repo: "databrainhq/backend",
  number,
  title: `issue ${number}`,
  url: `https://github.com/databrainhq/backend/issues/${number}`,
  body: "",
  column: "open",
  labels: [],
  author: "me",
  assignedToMe: true,
  createdByMe: true,
  comments: 0,
  pullRequests: [],
  links: [],
  closedAt: null,
  updatedAt: "2026-09-23T00:00:00Z",
  ...over,
});

const ids = (cs: readonly Candidate[]) => cs.map(c => c.ref);

test("finished work is never ranked: done, dropped, closed, or pull requests already merged", () => {
  const prs = new Map<string, PrState>([["databrainhq/backend#1", "merged"], ["databrainhq/backend#2", "open"], ["databrainhq/backend#3", "closed"]]);
  const out = candidates({
    local: [note(0), note(1, { state: "done" }), note(2, { state: "dropped" }), note(3, { links: [pr(1)] }), note(4, { links: [pr(1), pr(2)], state: "doing" })],
    linear: [ticket("DEV-1"), ticket("DEV-2", { column: "done" }), ticket("DEV-3", { column: "review", links: [pr(1)] }), ticket("DEV-4", { links: [pr(3)] })],
    github: [
      issue(10),
      issue(11, { column: "closed" }),
      issue(12, { pullRequests: [{ repo: "databrainhq/backend", number: 5, url: "", state: "merged" }] }),
      issue(13, { column: "progress", pullRequests: [{ repo: "databrainhq/backend", number: 6, url: "", state: "open" }] }),
    ],
    prs,
    today: TODAY,
  });
  expect(ids(out)).toEqual(["2026-09-23", "2026-09-23", "DEV-1", "DEV-4", "backend#10", "backend#13"]);
  expect(out.filter(c => c.source === "local").map(c => c.id)).toEqual(["2026-09-23:0", "2026-09-23:4"]);
});

test("work tracked in two places is ranked once, as the ticket", () => {
  const out = candidates({
    local: [
      note(0, { links: [{ kind: "linear", url: "", id: "DEV-1" }] }),
      note(1, { links: [{ kind: "linear", url: "", id: "DEV-2" }] }),
      note(2, { links: [{ kind: "linear", url: "", id: "DEV-99" }] }),
    ],
    linear: [ticket("DEV-1", { links: [{ kind: "issue", url: "", repo: "databrainhq/backend", number: 10 }] }), ticket("DEV-2", { column: "done" })],
    github: [issue(10, { author: "linear" }), issue(11)],
    prs: new Map(),
    today: TODAY,
  });
  expect(out.map(c => c.id)).toEqual(["2026-09-23:2", "DEV-1", "I11"]);
});

test("rank batches items, reads each item's answers, and sorts by return on investment", async () => {
  const items = ["a", "b", "c"].map((title): Candidate => ({ source: "local", id: title, ref: TODAY, title, facts: {} }));
  const scores: Record<string, number> = { item_0: 1.2, item_1: 2.8, item_2: 2.1 };
  const calls: string[][] = [];
  const jev: Jev = async (_state, questions) => {
    const keys = Object.keys(questions).filter(k => k.startsWith("roi_")).map(k => k.slice(4));
    calls.push(keys);
    const answers = Object.fromEntries(
      keys.flatMap(k => [
        [`roi_${k}`, { type: "score" as const, score: scores[k] ?? 0, confidence: 0.9 }],
        [`why_${k}`, { type: "choice" as const, choice: k === "item_2" ? "vibes" : "in flight", confidence: 0.8 }],
      ]),
    );
    return { answers, costUsd: 0.001 };
  };
  const out = await rank(jev, items, { profile: "p", today: TODAY, batch: 2 });
  expect(calls).toEqual([["item_0", "item_1"], ["item_2"]]);
  expect(out.ranked.map(r => [r.title, r.score])).toEqual([["b", 2.8], ["a", 1.2]]);
  expect(out.costUsd).toBeCloseTo(0.002);
});

function onDemand(jev: Jev, tasks: () => LocalTask[], saved: RankingStore<PriorityItem> = createRankingStore(openDb(":memory:"), RANKING_ROWS.priority, PriorityItemSchema)) {
  return createPriority({
    jev,
    saved,
    prStates: async () => new Map(),
    local: () => ({ kind: "ready", today: TODAY, notes: [], tasks: tasks(), changedAt: 0 }),
    linear: async () => ({ kind: "unavailable", reason: "no key" }),
    github: async () => ({ kind: "unavailable", reason: "no token" }),
    profile: "p",
    batch: 25,
    shown: 8,
  });
}

const answersFor = (n: number) =>
  Object.fromEntries(
    Array.from({ length: n }, (_, i) => [
      [`roi_item_${i}`, { type: "score" as const, score: 2 - i, confidence: 1 }],
      [`why_item_${i}`, { type: "choice" as const, choice: "hygiene", confidence: 1 }],
    ]).flat(),
  );

test("Jev is asked only on refresh; reads serve the last ranking, minus work finished since", async () => {
  let calls = 0;
  let tasks = [note(0), note(1)];
  const priority = onDemand(async () => {
    calls++;
    return { answers: answersFor(2), costUsd: 0 };
  }, () => tasks);

  expect(await priority.snapshot()).toEqual({ kind: "unranked" });
  await priority.refresh();
  tasks = [note(0, { title: "renamed" }), note(1), note(2)];
  await priority.snapshot();
  expect(calls).toBe(1);

  tasks = [note(0, { state: "done" }), note(1)];
  expect(await priority.snapshot()).toMatchObject({ kind: "ready", items: [{ id: "2026-09-23:1" }], more: 0 });
  expect(calls).toBe(1);
});

test("a failed refresh shows why, and the next press tries again", async () => {
  let limitReached = true;
  const priority = onDemand(async () => {
    if (limitReached) throw new Error("jev answered 403: Key limit exceeded");
    return { answers: answersFor(1), costUsd: 0 };
  }, () => [note(0)]);
  expect(await priority.refresh()).toEqual({ kind: "unavailable", reason: "jev answered 403: Key limit exceeded" });
  limitReached = false;
  expect(await priority.snapshot()).toMatchObject({ kind: "unavailable" });
  expect(await priority.refresh()).toMatchObject({ kind: "ready", items: [{ id: "2026-09-23:0" }] });
});

test("the last ranking survives a hub restart and is kept until the next refresh", async () => {
  const saved = createRankingStore(openDb(":memory:"), RANKING_ROWS.priority, PriorityItemSchema);
  const tasks = () => [note(0), note(1)];
  await onDemand(async () => ({ answers: answersFor(2), costUsd: 0.004 }), tasks, saved).refresh();

  let calls = 0;
  const restarted = onDemand(async () => {
    calls++;
    throw new Error("jev answered 403: Key limit exceeded");
  }, tasks, saved);
  const ready = { kind: "ready", items: [{ id: "2026-09-23:0" }, { id: "2026-09-23:1" }], costUsd: 0.004 };
  expect(await restarted.snapshot()).toMatchObject(ready);
  expect(calls).toBe(0);

  await restarted.refresh();
  expect(await onDemand(async () => ({ answers: {}, costUsd: 0 }), tasks, saved).snapshot()).toMatchObject(ready);
});
