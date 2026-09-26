import { expect, test } from "bun:test";
import { z } from "zod";
import { ReadinessItemSchema, type ShipPr } from "@/shared/ship";
import type { LinearIssue } from "@/shared/tasks";
import { openDb } from "../db";
import type { Jev, JevAnswer } from "../jev";
import { createRankingStore, RANKING_ROWS } from "../ranking";
import type { PrContext } from "./github";
import { createMergeReadiness, evidenceOf, factsOf, linkedTicket, rankReadiness, stackOf, type Context } from "./readiness";

const NOW = Date.parse("2026-09-25T12:00:00Z");

const pr = (number: number, over: Partial<ShipPr> = {}): ShipPr => ({
  id: `P${number}`,
  repo: "databrainhq/backend",
  number,
  title: `pr ${number}`,
  url: `https://github.com/databrainhq/backend/pull/${number}`,
  body: "",
  author: "me",
  draft: false,
  head: `branch-${number}`,
  base: "develop",
  additions: 10,
  deletions: 2,
  changedFiles: 1,
  files: [{ path: "src/index.ts", additions: 10, deletions: 2 }],
  checks: [],
  reviews: [],
  pending: [],
  conflicts: false,
  relation: "author",
  newCommits: 0,
  state: "waiting",
  why: "no reviewer yet",
  createdAt: "2026-09-20T00:00:00Z",
  updatedAt: "2026-09-24T00:00:00Z",
  ...over,
});

const ticket = (identifier: string, over: Partial<LinearIssue> = {}): LinearIssue => ({
  id: identifier,
  identifier,
  title: identifier,
  url: "",
  description: "",
  priority: "high",
  column: "review",
  stateName: "In Review",
  team: { id: "t", key: "DAT", name: "Data" },
  assignee: null,
  creator: null,
  cycle: { number: 12, endsAt: "2026-09-26T00:00:00Z" },
  links: [],
  updatedAt: "2026-09-24T00:00:00Z",
  ...over,
});

const ctx = (over: Partial<PrContext> = {}): PrContext => ({ mergeState: "CLEAN", paths: ["src/index.ts"], commitsSinceReview: null, unresolved: [], ...over });

test("a ticket is linked by an attached pull request first, then by its identifier in the title, branch or body", () => {
  const attached = ticket("DAT-1", { links: [{ kind: "pr", url: "", repo: "databrainhq/backend", number: 7 }] });
  const named = ticket("DAT-88");
  expect(linkedTicket(pr(7, { title: "DAT-88 fix" }), [named, attached])?.identifier).toBe("DAT-1");
  expect(linkedTicket(pr(8, { head: "rikato/dat-88-cache" }), [named, attached])?.identifier).toBe("DAT-88");
  expect(linkedTicket(pr(9, { body: "see DAT-880" }), [named, attached])).toBeUndefined();
});

test("a stack is read from branches in the same repo", () => {
  const bottom = pr(1, { head: "a", base: "develop" });
  const middle = pr(2, { head: "b", base: "a" });
  const top = pr(3, { head: "c", base: "b" });
  const elsewhere = pr(4, { repo: "databrainhq/frontend-mono", base: "b" });
  const mine = [bottom, middle, top, elsewhere];
  expect(stackOf(middle, mine)).toEqual({ on: "backend#1", baseOf: ["backend#3"] });
  expect(stackOf(bottom, mine)).toEqual({ on: null, baseOf: ["backend#2"] });
});

test("Jev sees the whole picture and the row keeps a short readable trail of it", () => {
  const context: Context = {
    pr: pr(403, {
      title: "feat(semantic): metric aliases",
      why: "changes: priya",
      additions: 240,
      deletions: 31,
      changedFiles: 6,
      updatedAt: "2026-09-15T00:00:00Z",
      checks: [{ name: "lint", conclusion: "failed", url: null }],
      reviews: [{ login: "priya", state: "changes" }],
    }),
    ctx: ctx({ mergeState: "BEHIND", commitsSinceReview: 1, unresolved: [[{ author: "priya", body: "null handling\nin the alias join? this reads past the end" }, { author: "bot", body: '<a href="#"><img alt="P1" src="x.svg"></a> <!-- meta -->' }]] }),
    ticket: ticket("DAT-881"),
    stack: { on: null, baseOf: ["backend#407"] },
  };
  expect(factsOf(context, NOW)).toMatchObject({
    pr: "backend#403",
    days_since_update: 10,
    failing_checks: ["lint"],
    changes_requested_by: ["priya"],
    merge_state: "BEHIND",
    unresolved_threads: 1,
    unresolved_comments: [
      { author: "priya", text: "null handling in the alias join? this reads past the end" },
      { author: "bot", text: "" },
    ],
    base_of: ["backend#407"],
    linear_ticket: { ticket: "DAT-881", state: "In Review", priority: "high", cycle_ends: "2026-09-26" },
  });
  expect(evidenceOf(context, NOW)).toEqual([
    "changes: priya",
    "+240 −31 · 6 files",
    "1 unresolved thread",
    'last: "null handling in the alias join? this reads past the end"',
    "1 commit since review",
    "behind base",
    "base of backend#407",
    "DAT-881 · In Review · cycle ends 09-26",
    "idle 10d",
  ]);
});


const SentSchema = z.object({ pull_requests: z.array(z.object({ key: z.string(), title: z.string() })) });

function fakeJev(byTitle: Record<string, [number, string]>, calls: string[][] = []): Jev {
  return async (state, questions) => {
    const keys = Object.keys(questions).filter(k => k.startsWith("ready_")).map(k => k.slice(6));
    calls.push(keys);
    const prs = SentSchema.parse(state).pull_requests;
    const answers = Object.fromEntries(
      prs.flatMap(p => {
        const [score, move] = byTitle[p.title] ?? [0, "close"];
        const ready: JevAnswer = { type: "score", score, confidence: 1 };
        const next: JevAnswer = { type: "choice", choice: move, confidence: 1 };
        return [[`ready_${p.key}`, ready], [`move_${p.key}`, next]];
      }),
    );
    return { answers, costUsd: 0.001 };
  };
}

test("rank asks per pull request in batches, drops unknown moves, and puts the closest to merged first", async () => {
  const calls: string[][] = [];
  const contexts = [pr(1, { title: "a" }), pr(2, { title: "b" }), pr(3, { title: "c" })].map((p): Context => ({ pr: p, ctx: ctx(), ticket: undefined, stack: { on: null, baseOf: [] } }));
  const jev = fakeJev({ a: [1.1, "fix ci"], b: [2.9, "merge"], c: [2, "yolo"] }, calls);
  const out = await rankReadiness(jev, contexts, { profile: "p", batch: 2, now: NOW });
  expect(calls).toEqual([["item_0", "item_1"], ["item_2"]]);
  expect(out.ranked.map(r => [r.title, r.score, r.move])).toEqual([["b", 2.9, "merge"], ["a", 1.1, "fix ci"]]);
  expect(out.ranked[0]?.evidence[0]).toBe("no reviewer yet");
  expect(out.costUsd).toBeCloseTo(0.002);
});

test("merge readiness ranks only on refresh, drops merged pull requests, counts new ones, and survives a restart", async () => {
  let mine = [pr(1, { title: "a" }), pr(2, { title: "b" })];
  let contextCalls = 0;
  const saved = createRankingStore(openDb(":memory:"), RANKING_ROWS.mergeReadiness, ReadinessItemSchema);
  const readiness = (jev: Jev) =>
    createMergeReadiness({
      jev,
      saved,
      mine: async () => mine,
      contexts: async () => {
        contextCalls++;
        return new Map();
      },
      linear: async () => ({ kind: "unavailable", reason: "no key" }),
      profile: "p",
      batch: 25,
      shown: 8,
    });
  const first = readiness(fakeJev({ a: [1, "rebase"], b: [3, "merge"] }));

  expect(await first.snapshot()).toEqual({ kind: "unranked" });
  expect(contextCalls).toBe(0);
  expect(await first.refresh()).toMatchObject({ kind: "ready", items: [{ id: "P2" }, { id: "P1" }], unranked: 0 });

  mine = [pr(1, { title: "a" }), pr(5, { title: "new" })];
  expect(await first.snapshot()).toMatchObject({ kind: "ready", items: [{ id: "P1", move: "rebase" }], unranked: 1 });
  expect(contextCalls).toBe(1);

  const restarted = readiness(async () => {
    throw new Error("jev should not be asked on read");
  });
  expect(await restarted.snapshot()).toMatchObject({ kind: "ready", items: [{ id: "P1" }] });
});

test("when GitHub is unreachable the saved ranking says why instead of showing an empty list", async () => {
  const readiness = createMergeReadiness({
    jev: fakeJev({ a: [3, "merge"] }),
    saved: createRankingStore(openDb(":memory:"), RANKING_ROWS.mergeReadiness, ReadinessItemSchema),
    mine: async () => {
      throw new Error("github answered 502");
    },
    contexts: async () => new Map(),
    linear: async () => ({ kind: "unavailable", reason: "no key" }),
    profile: "p",
    batch: 25,
    shown: 8,
  });
  expect(await readiness.refresh()).toEqual({ kind: "unavailable", reason: "github answered 502" });
});
