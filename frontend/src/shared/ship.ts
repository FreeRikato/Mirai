import { z } from "zod";
import type { Hunk } from "./diff";
import type { RankingSnapshot } from "./ranking";

export const SHIP_QUEUES = ["mine", "review", "all"] as const;
export type ShipQueue = (typeof SHIP_QUEUES)[number];
export const isShipQueue = (s: unknown): s is ShipQueue => SHIP_QUEUES.some(x => x === s);

export const SHIP_STATES = ["ready", "blocked", "waiting", "draft"] as const;
export type ShipState = (typeof SHIP_STATES)[number];

export type Relation = "author" | "requested" | "rereview" | "reviewed" | "none";

export type CheckConclusion = "passed" | "failed" | "pending" | "skipped";
export type Check = { name: string; conclusion: CheckConclusion; url: string | null };

export type Review = { login: string; state: "approved" | "changes" | "commented" };

export type ShipPr = {
  id: string;
  repo: string;
  number: number;
  title: string;
  url: string;
  body: string;
  author: string;
  draft: boolean;
  head: string;
  base: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  files: { path: string; additions: number; deletions: number }[];
  checks: Check[];
  reviews: Review[];
  pending: string[];
  conflicts: boolean;
  relation: Relation;
  newCommits: number;
  state: ShipState;
  why: string;
  createdAt: string;
  updatedAt: string;
};

export type ShipSnapshot =
  | { kind: "ready"; org: string; me: string; mine: ShipPr[]; review: ShipPr[]; fetchedAt: number }
  | { kind: "unavailable"; reason: string };

export type ShipBadge = { waiting: number };

export const shipBadge = (snapshot: ShipSnapshot): ShipBadge => ({ waiting: snapshot.kind === "ready" ? snapshot.review.length : 0 });

export type ShipSearch = { kind: "ready"; query: string; total: number; prs: ShipPr[] } | { kind: "unavailable"; reason: string };

export type ShipBody = { kind: "ready"; html: string } | { kind: "unavailable"; reason: string };

export type FileStatus = "added" | "removed" | "modified" | "renamed" | "copied" | "changed" | "unchanged";

export type ReviewFile = { path: string; previous: string | null; status: FileStatus; additions: number; deletions: number; hunks: Hunk[] | null; viewed: boolean };

export type ThreadComment = { author: string; body: string; html: string; createdAt: string };

export type ReviewThread = { id: string; path: string; side: "LEFT" | "RIGHT"; line: number | null; originalLine: number | null; resolved: boolean; outdated: boolean; comments: ThreadComment[] };

export type ShipReview = { kind: "ready"; pr: ShipPr; headSha: string; baseSha: string; files: ReviewFile[]; threads: ReviewThread[] } | { kind: "unavailable"; reason: string };

export const VERDICTS = ["comment", "approve", "changes"] as const;
export type Verdict = (typeof VERDICTS)[number];

export const DraftCommentSchema = z.object({ path: z.string().min(1), side: z.enum(["LEFT", "RIGHT"]), line: z.number().int().positive(), body: z.string().trim().min(1) });
export type DraftComment = z.infer<typeof DraftCommentSchema>;

export const SubmitReviewSchema = z.object({
  id: z.string().min(1),
  headSha: z.string().min(1),
  verdict: z.enum(VERDICTS),
  body: z.string(),
  comments: z.array(DraftCommentSchema),
});
export type SubmitReview = z.infer<typeof SubmitReviewSchema>;

export const MarkViewedSchema = z.object({ id: z.string().min(1), path: z.string().min(1), viewed: z.boolean() });
export type MarkViewed = z.infer<typeof MarkViewedSchema>;

export function reviewProblem(review: Pick<SubmitReview, "verdict" | "body" | "comments">, ownPr: boolean): string | null {
  if (ownPr && review.verdict !== "comment") return "you can only comment on your own pull request";
  const empty = !review.body.trim() && review.comments.length === 0;
  if (empty && review.verdict === "comment") return "write a summary or a line comment";
  if (empty && review.verdict === "changes") return "say what needs to change";
  return null;
}

export const RequestReviewSchema = z.object({ id: z.string().min(1) });
export type RequestReview = z.infer<typeof RequestReviewSchema>;

type StateInput = Pick<ShipPr, "draft" | "checks" | "reviews" | "pending" | "conflicts">;

const names = (xs: readonly string[]) => (xs.length > 2 ? `${xs.slice(0, 2).join(", ")} +${xs.length - 2}` : xs.join(", "));

export function shipState(pr: StateInput): { state: ShipState; why: string } {
  const failed = pr.checks.filter(c => c.conclusion === "failed").map(c => c.name);
  const running = pr.checks.some(c => c.conclusion === "pending");
  const changes = pr.reviews.filter(r => r.state === "changes").map(r => r.login);
  const approved = pr.reviews.some(r => r.state === "approved");

  if (pr.draft) return { state: "draft", why: failed.length ? `draft, ci: ${names(failed)} failing` : "draft" };
  if (failed.length) return { state: "blocked", why: `ci: ${names(failed)} failing` };
  if (changes.length) return { state: "blocked", why: `changes: ${names(changes)}` };
  if (pr.conflicts) return { state: "blocked", why: "conflicts with base" };
  if (approved && !running) return { state: "ready", why: "approved, green" };
  if (running) return { state: "waiting", why: "checks running" };
  return { state: "waiting", why: pr.pending.length ? `waiting on ${names(pr.pending)}` : "no reviewer yet" };
}

export function relationOf(
  me: string,
  pr: { author: string; pending: readonly string[]; myReviewAt: string | null; commitDates: readonly string[] },
): { relation: Relation; newCommits: number } {
  if (pr.author === me) return { relation: "author", newCommits: 0 };
  if (pr.pending.includes(me)) return { relation: "requested", newCommits: 0 };
  if (pr.myReviewAt === null) return { relation: "none", newCommits: 0 };
  const reviewedAt = pr.myReviewAt;
  const newer = pr.commitDates.filter(d => d > reviewedAt).length;
  return newer > 0 ? { relation: "rereview", newCommits: newer } : { relation: "reviewed", newCommits: 0 };
}

export const MERGE_MOVES = ["merge", "fix ci", "address review", "rebase", "nudge reviewer", "finish draft", "split", "close"] as const;
export type MergeMove = (typeof MERGE_MOVES)[number];
export const isMergeMove = (s: string): s is MergeMove => MERGE_MOVES.some(m => m === s);

export const ReadinessItemSchema = z.object({
  id: z.string(),
  repo: z.string(),
  number: z.number(),
  title: z.string(),
  score: z.number(),
  move: z.enum(MERGE_MOVES),
  evidence: z.array(z.string()),
});
export type ReadinessItem = z.infer<typeof ReadinessItemSchema>;

export type ReadinessSnapshot = RankingSnapshot<ReadinessItem>;
