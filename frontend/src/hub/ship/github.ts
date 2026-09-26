import { z } from "zod";
import { parsePatch } from "@/shared/diff";
import { relationOf, reviewProblem, shipState, type Check, type CheckConclusion, type FileStatus, type MarkViewed, type Review, type ReviewFile, type ReviewThread, type ShipBody, type ShipPr, type ShipReview, type ShipSearch, type ShipSnapshot, type SubmitReview, type Verdict } from "@/shared/ship";
import type { RemoteLimits } from "../config";
import type { GithubApi, GithubRest } from "../githubApi";
import { cached, paginate, RemoteError } from "../remote";

const CheckNodeSchema = z.union([
  z.object({ __typename: z.literal("CheckRun"), name: z.string(), status: z.string(), conclusion: z.string().nullable(), detailsUrl: z.string().nullable(), completedAt: z.string().nullable() }),
  z.object({ __typename: z.literal("StatusContext"), context: z.string(), state: z.string(), targetUrl: z.string().nullable(), createdAt: z.string() }),
]);

export const PrNodeSchema = z.object({
  id: z.string(),
  number: z.number(),
  title: z.string(),
  url: z.string(),
  body: z.string(),
  isDraft: z.boolean(),
  headRefName: z.string(),
  baseRefName: z.string(),
  additions: z.number(),
  deletions: z.number(),
  changedFiles: z.number(),
  mergeable: z.enum(["MERGEABLE", "CONFLICTING", "UNKNOWN"]),
  createdAt: z.string(),
  updatedAt: z.string(),
  author: z.object({ login: z.string() }).nullable(),
  repository: z.object({ nameWithOwner: z.string() }),
  reviewRequests: z.object({ nodes: z.array(z.object({ requestedReviewer: z.object({ login: z.string().optional(), slug: z.string().optional() }).nullable() })) }),
  latestReviews: z.object({ nodes: z.array(z.object({ author: z.object({ login: z.string() }).nullable(), state: z.string(), submittedAt: z.string().nullable() })) }),
  files: z.object({ nodes: z.array(z.object({ path: z.string(), additions: z.number(), deletions: z.number() })) }).nullable(),
  commits: z.object({
    nodes: z.array(
      z.object({
        commit: z.object({
          committedDate: z.string(),
          statusCheckRollup: z.object({ contexts: z.object({ nodes: z.array(z.unknown()) }) }).nullable(),
        }),
      }),
    ),
  }),
});
type PrNode = z.infer<typeof PrNodeSchema>;

export const PR_FIELDS = `... on PullRequest {
  id number title url body isDraft headRefName baseRefName additions deletions changedFiles mergeable createdAt updatedAt
  author { login }
  repository { nameWithOwner }
  reviewRequests(first: 20) { nodes { requestedReviewer { ... on User { login } ... on Team { slug } } } }
  latestReviews(first: 20) { nodes { author { login } state submittedAt } }
  files(first: 5) { nodes { path additions deletions } }
  commits(last: 30) { nodes { commit { committedDate statusCheckRollup { contexts(first: 100) { nodes {
    __typename
    ... on CheckRun { name status conclusion detailsUrl completedAt }
    ... on StatusContext { context state targetUrl createdAt }
  } } } } } }
}`;

const SEARCH = `query Search($q: String!, $after: String, $first: Int!) {
  search(type: ISSUE, first: $first, after: $after, query: $q) { issueCount nodes { ${PR_FIELDS} } pageInfo { hasNextPage endCursor } }
}`;
const VIEWER = `query Viewer { viewer { login id } }`;
const BODY = `query Body($id: ID!) { node(id: $id) { ... on PullRequest { bodyHTML } } }`;
const BodySchema = z.object({ node: z.object({ bodyHTML: z.string().optional() }).nullable() });
const REQUEST = `mutation Request($pr: ID!, $me: ID!) { requestReviews(input: { pullRequestId: $pr, userIds: [$me], union: true }) { pullRequest { id } } }`;

const REVIEW = `query Review($id: ID!) { node(id: $id) { ${PR_FIELDS} ... on PullRequest {
  headRefOid
  baseRefOid
  reviewThreads(first: 100) { nodes { id isResolved isOutdated path line originalLine diffSide comments(first: 50) { nodes { author { login } body bodyHTML createdAt } } } }
} } }`;
const VIEWED = `query Viewed($id: ID!, $after: String) { node(id: $id) { ... on PullRequest {
  files(first: 100, after: $after) { nodes { path viewerViewedState } pageInfo { hasNextPage endCursor } }
} } }`;
const SUBMIT = `mutation Submit($input: AddPullRequestReviewInput!) { addPullRequestReview(input: $input) { pullRequestReview { id } } }`;
const MARK_VIEWED = `mutation MarkViewed($input: MarkFileAsViewedInput!) { markFileAsViewed(input: $input) { clientMutationId } }`;
const UNMARK_VIEWED = `mutation UnmarkViewed($input: UnmarkFileAsViewedInput!) { unmarkFileAsViewed(input: $input) { clientMutationId } }`;

const CONTEXT = `query Context($ids: [ID!]!) { nodes(ids: $ids) { ... on PullRequest {
  id mergeStateStatus
  files(first: 40) { nodes { path } }
  latestReviews(first: 20) { nodes { author { login } submittedAt } }
  commits(last: 30) { nodes { commit { committedDate } } }
  reviewThreads(first: 50) { nodes { isResolved comments(last: 2) { nodes { author { login } body } } } }
} } }`;
const CONTEXT_IDS = 50;
const ContextNodeSchema = z.object({
  id: z.string(),
  mergeStateStatus: z.string(),
  files: z.object({ nodes: z.array(z.object({ path: z.string() })) }).nullable(),
  latestReviews: z.object({ nodes: z.array(z.object({ author: z.object({ login: z.string() }).nullable(), submittedAt: z.string().nullable() })) }),
  commits: z.object({ nodes: z.array(z.object({ commit: z.object({ committedDate: z.string() }) })) }),
  reviewThreads: z.object({ nodes: z.array(z.object({ isResolved: z.boolean(), comments: z.object({ nodes: z.array(z.object({ author: z.object({ login: z.string() }).nullable(), body: z.string() })) }) })) }),
});
const ContextSchema = z.object({ nodes: z.array(z.unknown()) });

export type ThreadNote = { author: string; body: string };
export type PrContext = { mergeState: string; paths: string[]; commitsSinceReview: number | null; unresolved: ThreadNote[][] };

export function toContext(n: z.infer<typeof ContextNodeSchema>, author: string): PrContext {
  const reviewedAt = n.latestReviews.nodes
    .filter(r => r.author && r.author.login !== author)
    .flatMap(r => r.submittedAt ?? [])
    .toSorted()
    .at(-1);
  return {
    mergeState: n.mergeStateStatus,
    paths: n.files?.nodes.map(f => f.path) ?? [],
    commitsSinceReview: reviewedAt === undefined ? null : n.commits.nodes.filter(c => c.commit.committedDate > reviewedAt).length,
    unresolved: n.reviewThreads.nodes.filter(t => !t.isResolved).map(t => t.comments.nodes.map(c => ({ author: c.author?.login ?? "ghost", body: c.body }))),
  };
}

const ThreadSchema = z.object({
  id: z.string(),
  isResolved: z.boolean(),
  isOutdated: z.boolean(),
  path: z.string(),
  line: z.number().nullable(),
  originalLine: z.number().nullable(),
  diffSide: z.enum(["LEFT", "RIGHT"]),
  comments: z.object({ nodes: z.array(z.object({ author: z.object({ login: z.string() }).nullable(), body: z.string(), bodyHTML: z.string(), createdAt: z.string() })) }),
});
const ReviewSchema = z.object({ node: PrNodeSchema.extend({ headRefOid: z.string(), baseRefOid: z.string(), reviewThreads: z.object({ nodes: z.array(ThreadSchema) }) }).nullable() });
const ViewedSchema = z.object({
  node: z.object({
    files: z.object({ nodes: z.array(z.object({ path: z.string(), viewerViewedState: z.string() })), pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }) }),
  }),
});
const FILE_STATUSES = ["added", "removed", "modified", "renamed", "copied", "changed", "unchanged"] as const satisfies readonly FileStatus[];
const RestFilesSchema = z.array(
  z.object({ filename: z.string(), previous_filename: z.string().optional(), status: z.enum(FILE_STATUSES), additions: z.number(), deletions: z.number(), patch: z.string().optional() }),
);
const REST_PAGE = 100;

const EVENT: Record<Verdict, string> = { comment: "COMMENT", approve: "APPROVE", changes: "REQUEST_CHANGES" };

const toThread = (t: z.infer<typeof ThreadSchema>): ReviewThread => ({
  id: t.id,
  path: t.path,
  side: t.diffSide,
  line: t.isOutdated ? null : t.line,
  originalLine: t.originalLine,
  resolved: t.isResolved,
  outdated: t.isOutdated,
  comments: t.comments.nodes.map(c => ({ author: c.author?.login ?? "ghost", body: c.body, html: c.bodyHTML, createdAt: c.createdAt })),
});

const SearchSchema = z.object({
  search: z.object({ issueCount: z.number(), nodes: z.array(z.unknown()), pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }) }),
});
const ViewerSchema = z.object({ viewer: z.object({ login: z.string(), id: z.string() }) });

const PASSED = new Set(["SUCCESS", "NEUTRAL"]);
const SKIPPED = new Set(["SKIPPED", "STALE"]);

function conclusionOf(n: z.infer<typeof CheckNodeSchema>): CheckConclusion {
  if (n.__typename === "StatusContext") return n.state === "SUCCESS" ? "passed" : n.state === "PENDING" || n.state === "EXPECTED" ? "pending" : "failed";
  if (n.status !== "COMPLETED" || n.conclusion === null) return "pending";
  if (PASSED.has(n.conclusion)) return "passed";
  return SKIPPED.has(n.conclusion) ? "skipped" : "failed";
}

const checkName = (raw: string): string =>
  raw
    .replace(/,?\s*\$\{\{[^}]*\}\}/g, "")
    .replace(/\(\s*,?\s*\)/g, "")
    .replace(/\(\s*,\s*/g, "(")
    .replace(/\s{2,}/g, " ")
    .trim();

export function latestChecks(nodes: readonly unknown[]): Check[] {
  const newest = new Map<string, { at: string; check: Check }>();
  for (const raw of nodes) {
    const parsed = CheckNodeSchema.safeParse(raw);
    if (!parsed.success) continue;
    const n = parsed.data;
    const name = checkName(n.__typename === "CheckRun" ? n.name : n.context);
    const at = n.__typename === "CheckRun" ? (n.completedAt ?? "9999") : n.createdAt;
    const check: Check = { name, conclusion: conclusionOf(n), url: n.__typename === "CheckRun" ? n.detailsUrl : n.targetUrl };
    const seen = newest.get(name);
    if (!seen || at > seen.at) newest.set(name, { at, check });
  }
  return [...newest.values()].map(v => v.check);
}

const REVIEW_STATE: Record<string, Review["state"]> = { APPROVED: "approved", CHANGES_REQUESTED: "changes", COMMENTED: "commented" };

export function toPr(n: PrNode, me: string): ShipPr {
  const author = n.author?.login ?? "ghost";
  const pending = n.reviewRequests.nodes.flatMap(r => r.requestedReviewer?.login ?? r.requestedReviewer?.slug ?? []);
  const reviews = n.latestReviews.nodes.flatMap(r => {
    const state = REVIEW_STATE[r.state];
    return r.author && state && r.author.login !== author ? [{ login: r.author.login, state }] : [];
  });
  const commits = n.commits.nodes.map(c => c.commit);
  const head = commits.at(-1);
  const checks = latestChecks(head?.statusCheckRollup?.contexts.nodes ?? []);
  const myReviewAt = n.latestReviews.nodes.find(r => r.author?.login === me)?.submittedAt ?? null;
  const conflicts = n.mergeable === "CONFLICTING";
  return {
    id: n.id,
    repo: n.repository.nameWithOwner,
    number: n.number,
    title: n.title,
    url: n.url,
    body: n.body,
    author,
    draft: n.isDraft,
    head: n.headRefName,
    base: n.baseRefName,
    additions: n.additions,
    deletions: n.deletions,
    changedFiles: n.changedFiles,
    files: n.files?.nodes ?? [],
    checks,
    reviews,
    pending,
    conflicts,
    ...relationOf(me, { author, pending, myReviewAt, commitDates: commits.map(c => c.committedDate) }),
    ...shipState({ draft: n.isDraft, checks, reviews, pending: pending.map(p => (p === me ? "you" : p)), conflicts }),
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
  };
}

export function toPrs(me: string, nodes: readonly unknown[]): ShipPr[] {
  const seen = new Map<string, ShipPr>();
  for (const node of nodes) {
    const parsed = PrNodeSchema.safeParse(node);
    if (parsed.success && !seen.has(parsed.data.id)) seen.set(parsed.data.id, toPr(parsed.data, me));
  }
  return [...seen.values()].toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function searchQuery(org: string, q: string): string {
  const scope = `is:pr org:${org} archived:false`;
  const text = q.trim();
  return /\bis:(open|closed|merged|unmerged)\b/.test(text) ? `${scope} ${text}` : `${scope} is:open ${text}`.trim();
}

export function createShip({ api: call, rest, org, limits, searchSize }: { api: GithubApi; rest: GithubRest; org: string | undefined; limits: RemoteLimits; searchSize: number }) {
  const viewer = cached(async () => ViewerSchema.parse(await call(VIEWER)).viewer, 3_600_000);
  const all = (q: string) => paginate(async after => SearchSchema.parse(await call(SEARCH, { q, after, first: 50 })).search, limits.maxPages);

  const lists = cached(async () => {
    if (!org) throw new RemoteError("set MIRAI_SHIP_ORG on the hub to the GitHub org whose pull requests to show");
    const base = `is:pr is:open org:${org} archived:false`;
    const [me, mine, requested, reviewed] = await Promise.all([
      viewer.get().then(v => v.value),
      all(`${base} author:@me`),
      all(`${base} user-review-requested:@me`),
      all(`${base} reviewed-by:@me -author:@me`),
    ]);
    const waiting = toPrs(me.login, [...requested, ...reviewed]).filter(p => p.relation === "requested" || p.relation === "rereview");
    return { org, me: me.login, mine: toPrs(me.login, mine), review: waiting };
  }, limits.cacheMs);

  const reason = (err: unknown) => (err instanceof Error ? err.message : String(err));

  const restFiles = async (repo: string, number: number) => {
    const out: z.infer<typeof RestFilesSchema> = [];
    for (let page = 1; page <= limits.maxPages; page++) {
      const batch = RestFilesSchema.parse(await rest(`/repos/${repo}/pulls/${number}/files?per_page=${REST_PAGE}&page=${page}`));
      out.push(...batch);
      if (batch.length < REST_PAGE) return out;
    }
    throw new RemoteError(`more than ${limits.maxPages * REST_PAGE} changed files`);
  };

  const viewedPaths = async (id: string) => {
    const files = await paginate(async after => ViewedSchema.parse(await call(VIEWED, { id, after })).node.files, limits.maxPages);
    return new Set(files.filter(f => f.viewerViewedState === "VIEWED").map(f => f.path));
  };

  const contexts = async (prs: readonly ShipPr[]): Promise<Map<string, PrContext>> => {
    const authors = new Map(prs.map(p => [p.id, p.author]));
    const chunks = Array.from({ length: Math.ceil(prs.length / CONTEXT_IDS) }, (_, i) => prs.slice(i * CONTEXT_IDS, (i + 1) * CONTEXT_IDS).map(p => p.id));
    const nodes = (await Promise.all(chunks.map(async ids => ContextSchema.parse(await call(CONTEXT, { ids })).nodes))).flat();
    return new Map(
      nodes.flatMap(raw => {
        const parsed = ContextNodeSchema.safeParse(raw);
        return parsed.success ? [[parsed.data.id, toContext(parsed.data, authors.get(parsed.data.id) ?? "")] as const] : [];
      }),
    );
  };

  return {
    contexts,

    async mine(): Promise<ShipPr[]> {
      return (await lists.get()).value.mine;
    },

    async snapshot(): Promise<ShipSnapshot> {
      try {
        const { value, at } = await lists.get();
        return { kind: "ready", ...value, fetchedAt: at };
      } catch (err: unknown) {
        return { kind: "unavailable", reason: reason(err) };
      }
    },

    async search(q: string): Promise<ShipSearch> {
      if (!org) return { kind: "unavailable", reason: "set MIRAI_SHIP_ORG on the hub to the GitHub org whose pull requests to show" };
      try {
        const query = searchQuery(org, q);
        const [me, found] = await Promise.all([viewer.get().then(v => v.value), call(SEARCH, { q: `${query} sort:updated-desc`, after: null, first: searchSize })]);
        const { search } = SearchSchema.parse(found);
        return { kind: "ready", query, total: search.issueCount, prs: toPrs(me.login, search.nodes) };
      } catch (err: unknown) {
        return { kind: "unavailable", reason: reason(err) };
      }
    },

    async body(id: string): Promise<ShipBody> {
      try {
        const html = BodySchema.parse(await call(BODY, { id })).node?.bodyHTML;
        return html === undefined ? { kind: "unavailable", reason: "no pull request with that id" } : { kind: "ready", html };
      } catch (err: unknown) {
        return { kind: "unavailable", reason: reason(err) };
      }
    },

    async review(id: string): Promise<ShipReview> {
      try {
        const { value: me } = await viewer.get();
        const node = ReviewSchema.parse(await call(REVIEW, { id })).node;
        if (!node) return { kind: "unavailable", reason: "no pull request with that id" };
        const [changed, viewed] = await Promise.all([restFiles(node.repository.nameWithOwner, node.number), viewedPaths(id)]);
        const files: ReviewFile[] = changed.map(f => ({
          path: f.filename,
          previous: f.previous_filename ?? null,
          status: f.status,
          additions: f.additions,
          deletions: f.deletions,
          hunks: f.patch === undefined ? null : parsePatch(f.patch),
          viewed: viewed.has(f.filename),
        }));
        return { kind: "ready", pr: toPr(node, me.login), headSha: node.headRefOid, baseSha: node.baseRefOid, files, threads: node.reviewThreads.nodes.map(toThread) };
      } catch (err: unknown) {
        return { kind: "unavailable", reason: reason(err) };
      }
    },

    async submit(review: SubmitReview): Promise<{ ok: true } | { ok: false; error: string }> {
      const problem = reviewProblem(review, false);
      if (problem) return { ok: false, error: problem };
      await call(SUBMIT, { input: { pullRequestId: review.id, commitOID: review.headSha, event: EVENT[review.verdict], body: review.body, threads: review.comments } });
      lists.invalidate();
      return { ok: true };
    },

    async viewed({ id, path, viewed }: MarkViewed): Promise<{ ok: true }> {
      await call(viewed ? MARK_VIEWED : UNMARK_VIEWED, { input: { pullRequestId: id, path } });
      return { ok: true };
    },

    async requestMe(id: string): Promise<{ ok: true }> {
      const { value: me } = await viewer.get();
      await call(REQUEST, { pr: id, me: me.id });
      lists.invalidate();
      return { ok: true };
    },
  };
}

export type Ship = ReturnType<typeof createShip>;
