import { expect, test } from "bun:test";
import type { ShipPr } from "@/shared/ship";
import { checkSummary, diffText, groupMine, groupReview, narrow, reviewSummary, stateTone, step } from "./derive";

const pr = (over: Partial<ShipPr> & Pick<ShipPr, "id">): ShipPr => ({
  repo: "databrainhq/backend",
  number: 1,
  title: "fix(rls): scope semantic cache",
  url: "https://github.com/databrainhq/backend/pull/1",
  body: "",
  author: "me",
  draft: false,
  head: "fix/rls-cache",
  base: "develop",
  additions: 10,
  deletions: 2,
  changedFiles: 1,
  files: [],
  checks: [],
  reviews: [],
  pending: [],
  conflicts: false,
  relation: "author",
  newCommits: 0,
  state: "waiting",
  why: "no reviewer yet",
  createdAt: "2026-09-23T00:00:00Z",
  updatedAt: "2026-09-23T00:00:00Z",
  ...over,
});

test("the filter needs every typed word somewhere in the row, and respects state and hidden repos", () => {
  const prs = [pr({ id: "a", title: "embed token rotation" }), pr({ id: "b", number: 3712, repo: "databrainhq/frontend-mono", state: "ready" })];
  expect(narrow(prs, { text: "EMBED rotation", state: null, hiddenRepos: [] }).map(p => p.id)).toEqual(["a"]);
  expect(narrow(prs, { text: "#3712", state: null, hiddenRepos: [] }).map(p => p.id)).toEqual(["b"]);
  expect(narrow(prs, { text: "", state: "ready", hiddenRepos: [] }).map(p => p.id)).toEqual(["b"]);
  expect(narrow(prs, { text: "", state: null, hiddenRepos: ["databrainhq/backend"] }).map(p => p.id)).toEqual(["b"]);
});

test("mine groups in ship order and skips empty groups; review puts re-reviews first", () => {
  const mine = groupMine([pr({ id: "d", state: "draft" }), pr({ id: "r", state: "ready" })]);
  expect(mine.map(g => [g.id, g.prs.map(p => p.id)])).toEqual([
    ["ready", ["r"]],
    ["draft", ["d"]],
  ]);
  const review = groupReview([pr({ id: "q", relation: "requested" }), pr({ id: "rr", relation: "rereview" })]);
  expect(review.map(g => g.id)).toEqual(["rereview", "requested"]);
});

test("blocked is red for ci or conflicts and amber for requested changes", () => {
  expect(stateTone(pr({ id: "x", state: "blocked", checks: [{ name: "e2e", conclusion: "failed", url: null }] }))).toBe("bad");
  expect(stateTone(pr({ id: "x", state: "blocked", conflicts: true }))).toBe("bad");
  expect(stateTone(pr({ id: "x", state: "blocked" }))).toBe("warn");
});

test("check and review summaries", () => {
  const checks = [
    { name: "a", conclusion: "passed" as const, url: null },
    { name: "b", conclusion: "failed" as const, url: null },
    { name: "c", conclusion: "skipped" as const, url: null },
  ];
  expect(checkSummary({ checks })).toEqual({ text: "1/2", tone: "bad" });
  expect(checkSummary({ checks: [] }).text).toBe("–");
  expect(reviewSummary({ reviews: [{ login: "a", state: "approved" }, { login: "b", state: "changes" }], pending: [] })).toEqual({ text: "1 ✗", tone: "warn" });
  expect(reviewSummary({ reviews: [], pending: ["a", "b"] }).text).toBe("0/2");
  expect(diffText({ additions: 1900, deletions: 240 })).toBe("+1.9k −240");
});

test("stepping moves within the list and stops at the ends", () => {
  expect(step(["a", "b"], null, 1)).toBe("a");
  expect(step(["a", "b"], "a", 1)).toBe("b");
  expect(step(["a", "b"], "b", 1)).toBe("b");
  expect(step(["a", "b"], "a", -1)).toBe("a");
  expect(step(["a", "b"], "gone", -1)).toBe("a");
  expect(step([], "a", 1)).toBeNull();
});
