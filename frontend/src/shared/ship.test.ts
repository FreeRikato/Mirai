import { describe, expect, test } from "bun:test";
import { relationOf, reviewProblem, shipBadge, shipState, type Check, type Review, type ShipPr } from "./ship";

const check = (name: string, conclusion: Check["conclusion"]): Check => ({ name, conclusion, url: null });
const review = (login: string, state: Review["state"]): Review => ({ login, state });
const base = { draft: false, checks: [check("lint", "passed")], reviews: [], pending: [], conflicts: false };

describe("shipState", () => {
  test("approved with green checks is ready", () => {
    expect(shipState({ ...base, reviews: [review("vk-db", "approved")] })).toEqual({ state: "ready", why: "approved, green" });
  });

  test("a failing check blocks even an approved PR, and names the check", () => {
    const pr = { ...base, checks: [check("lint", "passed"), check("e2e-rls", "failed")], reviews: [review("vk-db", "approved")] };
    expect(shipState(pr)).toEqual({ state: "blocked", why: "ci: e2e-rls failing" });
  });

  test("requested changes block, and win over an approval from someone else", () => {
    const pr = { ...base, reviews: [review("nisha-r", "approved"), review("vk-db", "changes")] };
    expect(shipState(pr)).toEqual({ state: "blocked", why: "changes: vk-db" });
  });

  test("a conflict with the base branch blocks", () => {
    expect(shipState({ ...base, conflicts: true, reviews: [review("vk-db", "approved")] }).why).toBe("conflicts with base");
  });

  test("an approval with checks still running waits instead of claiming ready", () => {
    const pr = { ...base, checks: [check("build", "pending")], reviews: [review("vk-db", "approved")] };
    expect(shipState(pr)).toEqual({ state: "waiting", why: "checks running" });
  });

  test("with no approval it waits on whoever was asked, or says nobody was", () => {
    expect(shipState({ ...base, pending: ["sanjay-m"] }).why).toBe("waiting on sanjay-m");
    expect(shipState({ ...base, pending: ["a", "b", "c"] }).why).toBe("waiting on a, b +1");
    expect(shipState(base).why).toBe("no reviewer yet");
  });

  test("a draft is a draft whatever else is true, but still mentions failing ci", () => {
    expect(shipState({ ...base, draft: true, reviews: [review("vk-db", "approved")] })).toEqual({ state: "draft", why: "draft" });
    expect(shipState({ ...base, draft: true, checks: [check("tsc", "failed")] }).why).toBe("draft, ci: tsc failing");
  });

  test("skipped checks neither pass nor block", () => {
    expect(shipState({ ...base, checks: [check("bundle", "skipped")], reviews: [review("vk-db", "approved")] }).state).toBe("ready");
  });
});

describe("relationOf", () => {
  const pr = { author: "sanjay-m", pending: [] as string[], myReviewAt: null as string | null, commitDates: ["2026-09-20T10:00:00Z"] };

  test("my own PR is authored whatever the reviews say", () => {
    expect(relationOf("me", { ...pr, author: "me", pending: ["me"] }).relation).toBe("author");
  });

  test("a pending request wins over an older review of mine", () => {
    expect(relationOf("me", { ...pr, pending: ["me"], myReviewAt: "2026-09-19T00:00:00Z" }).relation).toBe("requested");
  });

  test("commits after my review make it a re-review, counting only the newer ones", () => {
    const out = relationOf("me", { ...pr, myReviewAt: "2026-09-21T00:00:00Z", commitDates: ["2026-09-20T00:00:00Z", "2026-09-22T00:00:00Z", "2026-09-23T00:00:00Z"] });
    expect(out).toEqual({ relation: "rereview", newCommits: 2 });
  });

  test("nothing new since my review is just reviewed; never reviewed and not asked is none", () => {
    expect(relationOf("me", { ...pr, myReviewAt: "2026-09-21T00:00:00Z" }).relation).toBe("reviewed");
    expect(relationOf("me", pr).relation).toBe("none");
  });
});

describe("reviewProblem", () => {
  const comment = { path: "src/a.ts", side: "RIGHT" as const, line: 3, body: "slot leaks" };

  test("a plain comment review needs a summary or at least one line comment", () => {
    expect(reviewProblem({ verdict: "comment", body: "  ", comments: [] }, false)).toBe("write a summary or a line comment");
    expect(reviewProblem({ verdict: "comment", body: "", comments: [comment] }, false)).toBeNull();
  });

  test("requesting changes needs something to say, approving does not", () => {
    expect(reviewProblem({ verdict: "changes", body: "", comments: [] }, false)).toBe("say what needs to change");
    expect(reviewProblem({ verdict: "approve", body: "", comments: [] }, false)).toBeNull();
  });

  test("on your own pull request GitHub only takes comments", () => {
    expect(reviewProblem({ verdict: "approve", body: "lgtm", comments: [] }, true)).toBe("you can only comment on your own pull request");
    expect(reviewProblem({ verdict: "comment", body: "note", comments: [] }, true)).toBeNull();
  });
});

const waitingPr = (id: string): ShipPr => ({
  id,
  repo: "databrainhq/backend",
  number: 1,
  title: "fix(rls): scope semantic cache",
  url: "https://github.com/databrainhq/backend/pull/1",
  body: "",
  author: "teammate",
  draft: false,
  head: "fix/rls-cache",
  base: "develop",
  additions: 10,
  deletions: 2,
  changedFiles: 1,
  files: [],
  checks: [],
  reviews: [],
  pending: ["FreeRikato"],
  conflicts: false,
  relation: "requested",
  newCommits: 0,
  state: "waiting",
  why: "waiting on you",
  createdAt: "2026-09-23T00:00:00Z",
  updatedAt: "2026-09-23T00:00:00Z",
});

test("the nav badge counts only the pull requests waiting on me, and nothing when GitHub is unavailable", () => {
  expect(shipBadge({ kind: "ready", org: "databrainhq", me: "FreeRikato", mine: [waitingPr("PR_0")], review: [], fetchedAt: 1 })).toEqual({ waiting: 0 });
  expect(shipBadge({ kind: "unavailable", reason: "no token" })).toEqual({ waiting: 0 });
  expect(shipBadge({ kind: "ready", org: "databrainhq", me: "FreeRikato", mine: [], review: [waitingPr("PR_1"), waitingPr("PR_2")], fetchedAt: 1 })).toEqual({ waiting: 2 });
});
