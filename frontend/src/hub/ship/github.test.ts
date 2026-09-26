import { expect, test } from "bun:test";
import { RemoteError } from "../remote";
import { createShip, latestChecks, searchQuery, toContext, toPrs } from "./github";
import { restBase } from "../githubApi";

const run = (name: string, conclusion: string | null, completedAt: string | null, status = "COMPLETED") => ({
  __typename: "CheckRun",
  name,
  status,
  conclusion,
  detailsUrl: `https://github.com/databrainhq/backend/actions/runs/1/job/${name}`,
  completedAt,
});

const limits = { doneDays: 14, cacheMs: 30_000, maxPages: 2, timeoutMs: 1000 };
const noRest = async () => [];

const node = (over: Record<string, unknown> = {}) => ({
  id: "PR_1",
  number: 8231,
  title: "fix(rls): scope semantic cache by tenant id",
  url: "https://github.com/databrainhq/backend/pull/8231",
  body: "Keys now include tenant id.",
  isDraft: false,
  headRefName: "fix/rls-cache-scope",
  baseRefName: "develop",
  additions: 94,
  deletions: 31,
  changedFiles: 4,
  mergeable: "MERGEABLE",
  createdAt: "2026-09-23T10:00:00Z",
  updatedAt: "2026-09-23T12:00:00Z",
  author: { login: "me" },
  repository: { nameWithOwner: "databrainhq/backend" },
  reviewRequests: { nodes: [{ requestedReviewer: { login: "sanjay-m" } }, { requestedReviewer: { slug: "backend-team" } }] },
  latestReviews: { nodes: [] },
  files: { nodes: [{ path: "src/cache/semantic.ts", additions: 48, deletions: 22 }] },
  commits: { nodes: [{ commit: { committedDate: "2026-09-23T11:00:00Z", statusCheckRollup: { contexts: { nodes: [run("lint", "SUCCESS", "2026-09-23T11:05:00Z")] } } } }] },
  ...over,
});

test("a re-run replaces the earlier result of the same check, whatever order GitHub lists them in", () => {
  const checks = latestChecks([run("hygiene", "SUCCESS", "2026-09-23T12:00:00Z"), run("hygiene", "FAILURE", "2026-09-23T11:00:00Z"), run("vitest", "FAILURE", "2026-09-23T11:00:00Z")]);
  expect(checks.map(c => [c.name, c.conclusion])).toEqual([
    ["hygiene", "passed"],
    ["vitest", "failed"],
  ]);
});

test("in-progress runs are pending, skipped runs are skipped, and legacy statuses are read too", () => {
  const checks = latestChecks([
    run("build", null, null, "IN_PROGRESS"),
    run("bundle", "SKIPPED", "2026-09-23T11:00:00Z"),
    run("deploy", "TIMED_OUT", "2026-09-23T11:00:00Z"),
    { __typename: "StatusContext", context: "vercel", state: "PENDING", targetUrl: null, createdAt: "2026-09-23T11:00:00Z" },
    { unexpected: true },
  ]);
  expect(Object.fromEntries(checks.map(c => [c.name, c.conclusion]))).toEqual({ build: "pending", bundle: "skipped", deploy: "failed", vercel: "pending" });
});

test("a PR carries its pending reviewers (users and teams), ship state and my relation", () => {
  const [pr] = toPrs("me", [node()]);
  expect(pr).toMatchObject({ repo: "databrainhq/backend", pending: ["sanjay-m", "backend-team"], relation: "author", state: "waiting", why: "waiting on sanjay-m, backend-team" });
});

test("a request to me reads as waiting on you", () => {
  const [pr] = toPrs("me", [node({ author: { login: "vk-db" }, reviewRequests: { nodes: [{ requestedReviewer: { login: "me" } }] } })]);
  expect(pr).toMatchObject({ relation: "requested", pending: ["me"], why: "waiting on you" });
});

test("reviews keep each reviewer's latest verdict and drop the author's own replies", () => {
  const latestReviews = {
    nodes: [
      { author: { login: "vk-db" }, state: "CHANGES_REQUESTED", submittedAt: "2026-09-23T11:30:00Z" },
      { author: { login: "me" }, state: "COMMENTED", submittedAt: "2026-09-23T11:40:00Z" },
      { author: { login: "nisha-r" }, state: "DISMISSED", submittedAt: "2026-09-23T11:40:00Z" },
    ],
  };
  const [pr] = toPrs("me", [node({ latestReviews })]);
  expect(pr?.reviews).toEqual([{ login: "vk-db", state: "changes" }]);
  expect(pr?.why).toBe("changes: vk-db");
});

test("commits pushed after my review make someone else's PR a re-review", () => {
  const commits = {
    nodes: ["2026-09-20T00:00:00Z", "2026-09-22T00:00:00Z", "2026-09-23T00:00:00Z"].map(committedDate => ({ commit: { committedDate, statusCheckRollup: null } })),
  };
  const latestReviews = { nodes: [{ author: { login: "me" }, state: "APPROVED", submittedAt: "2026-09-21T00:00:00Z" }] };
  const [pr] = toPrs("me", [node({ author: { login: "vk-db" }, reviewRequests: { nodes: [] }, latestReviews, commits })]);
  expect(pr).toMatchObject({ relation: "rereview", newCommits: 2, checks: [] });
});

test("search results that are not full PRs are dropped and each PR appears once", () => {
  expect(toPrs("me", [node(), node(), {}, { id: "I_1", number: 3 }])).toHaveLength(1);
});

test("searches stay inside the org and default to open PRs unless the query picks a state", () => {
  expect(searchQuery("databrainhq", "  embed token ")).toBe("is:pr org:databrainhq archived:false is:open embed token");
  expect(searchQuery("databrainhq", "is:merged author:vk-db")).toBe("is:pr org:databrainhq archived:false is:merged author:vk-db");
  expect(searchQuery("databrainhq", "")).toBe("is:pr org:databrainhq archived:false is:open");
});

test("a PR's rendered description comes from GitHub, and a missing PR or a failure says why", async () => {
  const answers: unknown[] = [{ node: { bodyHTML: "<p>hi</p>" } }, { node: null }, { node: {} }];
  const api = async () => {
    const next = answers.shift();
    if (next === undefined) throw new RemoteError("github down");
    return next;
  };
  const ship = createShip({ api, rest: noRest, org: "databrainhq", limits, searchSize: 5 });
  expect(await ship.body("PR_1")).toEqual({ kind: "ready", html: "<p>hi</p>" });
  expect(await ship.body("PR_2")).toEqual({ kind: "unavailable", reason: "no pull request with that id" });
  expect(await ship.body("I_3")).toEqual({ kind: "unavailable", reason: "no pull request with that id" });
  expect(await ship.body("PR_4")).toEqual({ kind: "unavailable", reason: "github down" });
});

test("the REST base sits next to the GraphQL endpoint on github.com and on GitHub Enterprise", () => {
  expect(restBase("https://api.github.com/graphql")).toBe("https://api.github.com");
  expect(restBase("https://git.corp.example/api/graphql")).toBe("https://git.corp.example/api/v3");
});

const thread = (over: Record<string, unknown> = {}) => ({
  id: "T_1",
  isResolved: false,
  isOutdated: false,
  path: "src/workers/sqs/consumer.ts",
  line: 46,
  originalLine: 44,
  diffSide: "RIGHT",
  comments: { nodes: [{ author: { login: "SapnaSinghKhatik" }, body: "slot never frees", bodyHTML: "<p>slot never frees</p>", createdAt: "2026-09-24T10:00:00Z" }] },
  ...over,
});

function fakeGithub(answers: Record<string, unknown>) {
  const calls: { query: string; variables: Record<string, unknown> }[] = [];
  const api = async (query: string, variables: Record<string, unknown> = {}) => {
    calls.push({ query, variables });
    const name = /(query|mutation) (\w+)/.exec(query)?.[2] ?? "";
    if (!(name in answers)) throw new RemoteError(`unexpected ${name}`);
    return answers[name];
  };
  return { api, calls };
}

test("a review joins GitHub's PR, threads and viewed state with the REST patches, one entry per changed file", async () => {
  const { api } = fakeGithub({
    Viewer: { viewer: { login: "me", id: "U_me" } },
    Review: { node: { ...node({ author: { login: "jayakanth-infra" } }), headRefOid: "abc123", baseRefOid: "def456", reviewThreads: { nodes: [thread(), thread({ id: "T_2", isOutdated: true, line: null })] } } },
    Viewed: { node: { files: { nodes: [{ path: "src/workers/sqs/consumer.ts", viewerViewedState: "VIEWED" }], pageInfo: { hasNextPage: false, endCursor: null } } } },
  });
  const paths: string[] = [];
  const rest = async (path: string) => {
    paths.push(path);
    return [
      { filename: "src/workers/sqs/consumer.ts", status: "modified", additions: 1, deletions: 1, patch: "@@ -1 +1 @@\n-a\n+b" },
      { filename: "assets/logo.png", status: "added", additions: 0, deletions: 0 },
    ];
  };
  const review = await createShip({ api, rest, org: "databrainhq", limits, searchSize: 5 }).review("PR_1");
  if (review.kind !== "ready") throw new Error(review.reason);
  expect(paths).toEqual(["/repos/databrainhq/backend/pulls/8231/files?per_page=100&page=1"]);
  expect(review.headSha).toBe("abc123");
  expect(review.baseSha).toBe("def456");
  expect(review.pr).toMatchObject({ number: 8231, author: "jayakanth-infra" });
  expect(review.files.map(f => [f.path, f.viewed, f.hunks?.length ?? null])).toEqual([
    ["src/workers/sqs/consumer.ts", true, 1],
    ["assets/logo.png", false, null],
  ]);
  expect(review.threads.map(t => [t.id, t.side, t.line, t.outdated, t.comments[0]?.author])).toEqual([
    ["T_1", "RIGHT", 46, false, "SapnaSinghKhatik"],
    ["T_2", "RIGHT", null, true, "SapnaSinghKhatik"],
  ]);
});

test("a missing PR or a GitHub failure makes the review unavailable with the reason", async () => {
  const gone = createShip({ ...fakeGithub({ Viewer: { viewer: { login: "me", id: "U_me" } }, Review: { node: null } }), rest: noRest, org: "databrainhq", limits, searchSize: 5 });
  expect(await gone.review("PR_9")).toEqual({ kind: "unavailable", reason: "no pull request with that id" });
  const down = createShip({ ...fakeGithub({}), rest: noRest, org: "databrainhq", limits, searchSize: 5 });
  expect(await down.review("PR_9")).toEqual({ kind: "unavailable", reason: "unexpected Viewer" });
});

test("submitting sends every pending comment as one review on the reviewed commit", async () => {
  const { api, calls } = fakeGithub({ Submit: { addPullRequestReview: { pullRequestReview: { id: "R_1" } } } });
  const ship = createShip({ api, rest: noRest, org: "databrainhq", limits, searchSize: 5 });
  const comments = [{ path: "src/a.ts", side: "RIGHT" as const, line: 46, body: "wrap in try/finally" }];
  expect(await ship.submit({ id: "PR_1", headSha: "abc123", verdict: "changes", body: "one leak", comments })).toEqual({ ok: true });
  expect(calls.at(-1)?.variables).toEqual({
    input: { pullRequestId: "PR_1", commitOID: "abc123", event: "REQUEST_CHANGES", body: "one leak", threads: comments },
  });
});

test("an empty review is refused before it reaches GitHub", async () => {
  const { api, calls } = fakeGithub({});
  const ship = createShip({ api, rest: noRest, org: "databrainhq", limits, searchSize: 5 });
  expect(await ship.submit({ id: "PR_1", headSha: "abc123", verdict: "comment", body: " ", comments: [] })).toEqual({ ok: false, error: "write a summary or a line comment" });
  expect(calls).toHaveLength(0);
});

test("marking a file viewed and unviewed uses GitHub's own viewed state", async () => {
  const { api, calls } = fakeGithub({ MarkViewed: {}, UnmarkViewed: {} });
  const ship = createShip({ api, rest: noRest, org: "databrainhq", limits, searchSize: 5 });
  await ship.viewed({ id: "PR_1", path: "src/a.ts", viewed: true });
  await ship.viewed({ id: "PR_1", path: "src/a.ts", viewed: false });
  expect(calls.map(c => [/mutation (\w+)/.exec(c.query)?.[1], c.variables])).toEqual([
    ["MarkViewed", { input: { pullRequestId: "PR_1", path: "src/a.ts" } }],
    ["UnmarkViewed", { input: { pullRequestId: "PR_1", path: "src/a.ts" } }],
  ]);
});

test("check names drop GitHub Actions expressions that were never expanded", () => {
  const checks = latestChecks([run("Typecheck (${{ matrix.package }})", "FAILURE", "2026-09-24T10:00:00Z"), run("Test (web, ${{ matrix.node }})", "SUCCESS", "2026-09-24T10:00:00Z")]);
  expect(checks.map(c => c.name)).toEqual(["Typecheck", "Test (web)"]);
});

test("merge context counts commits after the latest outside review and keeps only unresolved threads", () => {
  const comment = (login: string, body: string) => ({ author: { login }, body });
  const out = toContext(
    {
      id: "P1",
      mergeStateStatus: "BEHIND",
      files: { nodes: [{ path: "a.ts" }, { path: "b.ts" }] },
      latestReviews: { nodes: [{ author: { login: "sam" }, submittedAt: "2026-09-20T00:00:00Z" }, { author: { login: "me" }, submittedAt: "2026-09-23T00:00:00Z" }] },
      commits: { nodes: ["2026-09-19T00:00:00Z", "2026-09-21T00:00:00Z", "2026-09-22T00:00:00Z"].map(committedDate => ({ commit: { committedDate } })) },
      reviewThreads: {
        nodes: [
          { isResolved: true, comments: { nodes: [comment("sam", "done")] } },
          { isResolved: false, comments: { nodes: [comment("sam", "why?"), comment("me", "because")] } },
        ],
      },
    },
    "me",
  );
  expect(out).toEqual({
    mergeState: "BEHIND",
    paths: ["a.ts", "b.ts"],
    commitsSinceReview: 2,
    unresolved: [[{ author: "sam", body: "why?" }, { author: "me", body: "because" }]],
  });
});
