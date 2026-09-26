import { expect, test } from "bun:test";
import { mergeIssues, toRef } from "./github";

const node = (over: Record<string, unknown> = {}) => ({
  id: "I_1",
  number: 3698,
  title: "Verify a saved LLM key",
  url: "https://github.com/databrainhq/backend/issues/3698",
  body: "Origin: https://github.com/databrainhq/frontend-mono/pull/8276 and https://github.com/databrainhq/backend/pull/9",
  state: "OPEN",
  closedAt: null,
  updatedAt: "2026-09-16T00:00:00Z",
  author: { login: "linear" },
  repository: { nameWithOwner: "databrainhq/backend" },
  assignees: { nodes: [{ login: "me" }] },
  labels: { nodes: [{ name: "bug", color: "d73a4a" }] },
  comments: { totalCount: 1 },
  closedByPullRequestsReferences: { nodes: [] },
  ...over,
});

test("an issue in both searches appears once, with who it belongs to", () => {
  const out = mergeIssues("me", [[node()], [node()], [{}]]);
  expect(out).toHaveLength(1);
  expect(out[0]).toMatchObject({ assignedToMe: true, createdByMe: false, column: "open", repo: "databrainhq/backend" });
});

test("an open pull request moves an issue to in progress, and closed wins over everything", () => {
  const pr = { nodes: [{ number: 9, url: "https://github.com/databrainhq/backend/pull/9", state: "OPEN", repository: { nameWithOwner: "databrainhq/backend" } }] };
  const [open] = mergeIssues("me", [[node({ closedByPullRequestsReferences: pr })]]);
  expect(open?.column).toBe("progress");
  expect(open?.pullRequests).toEqual([{ repo: "databrainhq/backend", number: 9, url: "https://github.com/databrainhq/backend/pull/9", state: "open" }]);
  expect(open?.links.map(l => l.url)).toEqual(["https://github.com/databrainhq/frontend-mono/pull/8276"]);
  expect(mergeIssues("me", [[node({ state: "CLOSED", closedByPullRequestsReferences: pr })]])[0]?.column).toBe("closed");
});

test("a number resolves to whichever of issue or pull request github has", () => {
  const viewer = { login: "me" };
  expect(toRef({ viewer, repository: { issueOrPullRequest: { __typename: "Issue", ...node() } } })).toMatchObject({ kind: "issue", issue: { number: 3698, assignedToMe: true } });
  expect(toRef({ viewer, repository: { issueOrPullRequest: null } }).kind).toBe("unavailable");
  expect(toRef({ viewer, repository: null }).kind).toBe("unavailable");
});
