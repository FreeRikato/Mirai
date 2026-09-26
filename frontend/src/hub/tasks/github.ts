import { z } from "zod";
import type { GithubColumn, GithubIssue, GithubMove, GithubSnapshot, PrState } from "@/shared/tasks";
import { extractLinks } from "@/shared/links";
import type { GithubRef } from "@/shared/refs";
import { PR_FIELDS, PrNodeSchema, toPr } from "../ship/github";
import type { RemoteLimits } from "../config";
import type { GithubApi } from "../githubApi";
import { cached, paginate } from "../remote";

const IssueNodeSchema = z.object({
  id: z.string(),
  number: z.number(),
  title: z.string(),
  url: z.string(),
  body: z.string(),
  state: z.enum(["OPEN", "CLOSED"]),
  closedAt: z.string().nullable(),
  updatedAt: z.string(),
  author: z.object({ login: z.string() }).nullable(),
  repository: z.object({ nameWithOwner: z.string() }),
  assignees: z.object({ nodes: z.array(z.object({ login: z.string() })) }),
  labels: z.object({ nodes: z.array(z.object({ name: z.string(), color: z.string() })) }),
  comments: z.object({ totalCount: z.number() }),
  closedByPullRequestsReferences: z.object({
    nodes: z.array(z.object({ number: z.number(), url: z.string(), state: z.enum(["OPEN", "CLOSED", "MERGED"]), repository: z.object({ nameWithOwner: z.string() }) })),
  }),
});

const SearchSchema = z.object({
  search: z.object({ nodes: z.array(z.unknown()), pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }) }),
});
const ViewerSchema = z.object({ viewer: z.object({ login: z.string() }) });

const ISSUE_FIELDS = `... on Issue {
  id number title url body state closedAt updatedAt
  author { login }
  repository { nameWithOwner }
  assignees(first: 100) { nodes { login } }
  labels(first: 100) { nodes { name color } }
  comments { totalCount }
  closedByPullRequestsReferences(first: 100, includeClosedPrs: true) { nodes { number url state repository { nameWithOwner } } }
}`;

const SEARCH = `query Search($q: String!, $after: String) {
  search(type: ISSUE, first: 100, after: $after, query: $q) { nodes { ${ISSUE_FIELDS} } pageInfo { hasNextPage endCursor } }
}`;
const VIEWER = `query Viewer { viewer { login } }`;
const REF = `query Ref($owner: String!, $name: String!, $number: Int!) {
  viewer { login }
  repository(owner: $owner, name: $name) { issueOrPullRequest(number: $number) { __typename ${ISSUE_FIELDS} ${PR_FIELDS} } }
}`;
const RefSchema = z.object({
  viewer: z.object({ login: z.string() }),
  repository: z.object({ issueOrPullRequest: z.object({ __typename: z.string() }).passthrough().nullable() }).nullable(),
});

const CLOSE = `mutation Close($id: ID!) { closeIssue(input: { issueId: $id, stateReason: COMPLETED }) { issue { id } } }`;
const REOPEN = `mutation Reopen($id: ID!) { reopenIssue(input: { issueId: $id }) { issue { id } } }`;

type Node = z.infer<typeof IssueNodeSchema>;

const PR_STATE = { OPEN: "open", CLOSED: "closed", MERGED: "merged" } as const satisfies Record<string, PrState>;

export function columnOf(n: Pick<Node, "state" | "closedByPullRequestsReferences">): GithubColumn {
  if (n.state === "CLOSED") return "closed";
  return n.closedByPullRequestsReferences.nodes.some(p => p.state === "OPEN") ? "progress" : "open";
}

export function toIssue(n: Node, me: string): GithubIssue {
  const pullRequests = n.closedByPullRequestsReferences.nodes.map(p => ({ repo: p.repository.nameWithOwner, number: p.number, url: p.url, state: PR_STATE[p.state] }));
  const links = extractLinks(n.body).links.filter(l => l.url !== n.url && !pullRequests.some(p => p.url === l.url));
  return {
    id: n.id,
    repo: n.repository.nameWithOwner,
    number: n.number,
    title: n.title,
    url: n.url,
    body: n.body,
    column: columnOf(n),
    labels: n.labels.nodes,
    author: n.author?.login ?? "ghost",
    assignedToMe: n.assignees.nodes.some(a => a.login === me),
    createdByMe: n.author?.login === me,
    comments: n.comments.totalCount,
    pullRequests,
    links,
    closedAt: n.closedAt,
    updatedAt: n.updatedAt,
  };
}

export function mergeIssues(me: string, lists: readonly unknown[][]): GithubIssue[] {
  const seen = new Map<string, GithubIssue>();
  for (const node of lists.flat()) {
    const parsed = IssueNodeSchema.safeParse(node);
    if (parsed.success && !seen.has(parsed.data.id)) seen.set(parsed.data.id, toIssue(parsed.data, me));
  }
  return [...seen.values()].toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function toRef(data: unknown): GithubRef {
  const { viewer, repository } = RefSchema.parse(data);
  const node = repository?.issueOrPullRequest;
  if (!node) return { kind: "unavailable", reason: "no issue or pull request with that number" };
  if (node.__typename === "PullRequest") return { kind: "pr", pr: toPr(PrNodeSchema.parse(node), viewer.login) };
  return { kind: "issue", issue: toIssue(IssueNodeSchema.parse(node), viewer.login) };
}

export function createGithub({ api: call, limits }: { api: GithubApi; limits: RemoteLimits }) {
  const issues = cached(async () => {
    const since = new Date(Date.now() - limits.doneDays * 86_400_000).toISOString().slice(0, 10);
    const base = "is:issue archived:false";
    const queries = [`${base} is:open assignee:@me`, `${base} is:open author:@me`, `${base} is:closed assignee:@me closed:>=${since}`, `${base} is:closed author:@me closed:>=${since}`];
    const [me, ...lists] = await Promise.all([
      call(VIEWER).then(d => ViewerSchema.parse(d).viewer.login),
      ...queries.map(q => paginate(async after => SearchSchema.parse(await call(SEARCH, { q, after })).search, limits.maxPages)),
    ]);
    return mergeIssues(me, lists);
  }, limits.cacheMs);

  return {
    async snapshot(): Promise<GithubSnapshot> {
      try {
        const { value, at } = await issues.get();
        return { kind: "ready", issues: value, fetchedAt: at };
      } catch (err: unknown) {
        return { kind: "unavailable", reason: err instanceof Error ? err.message : String(err) };
      }
    },

    async ref(repo: string, number: number): Promise<GithubRef> {
      const [owner, name] = repo.split("/");
      try {
        return toRef(await call(REF, { owner, name, number }));
      } catch (err: unknown) {
        return { kind: "unavailable", reason: err instanceof Error ? err.message : String(err) };
      }
    },

    async move(m: GithubMove): Promise<{ ok: true }> {
      await call(m.to === "closed" ? CLOSE : REOPEN, { id: m.id });
      issues.invalidate();
      return { ok: true };
    },
  };
}

export type Github = ReturnType<typeof createGithub>;
