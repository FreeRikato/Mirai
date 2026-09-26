import { z } from "zod";
import type { RankingSnapshot } from "./ranking";

export const TASK_SOURCES = ["local", "linear", "github"] as const;
export type TaskSource = (typeof TASK_SOURCES)[number];
export const isTaskSource = (s: unknown): s is TaskSource => TASK_SOURCES.some(x => x === s);

export const TASK_BOARDS = ["all", ...TASK_SOURCES] as const;
export type TaskBoard = (typeof TASK_BOARDS)[number];
export const isTaskBoard = (s: unknown): s is TaskBoard => TASK_BOARDS.some(x => x === s);

export type PrState = "open" | "merged" | "closed";

export type TaskLink =
  | { kind: "linear"; url: string; id: string }
  | { kind: "pr"; url: string; repo: string; number: number }
  | { kind: "issue"; url: string; repo: string; number: number }
  | { kind: "jam"; url: string; id: string }
  | { kind: "url"; url: string; host: string };

export const LOCAL_STATES = ["open", "doing", "done", "dropped"] as const;
export type LocalState = (typeof LOCAL_STATES)[number];
export const LocalStateSchema = z.enum(LOCAL_STATES);

export type LocalTask = {
  id: string;
  date: string;
  line: number;
  state: LocalState;
  title: string;
  raw: string;
  links: TaskLink[];
  subtasks: { done: number; total: number };
  block: string;
};

export type DailyNote = { date: string; counts: Record<LocalState, number> };

export type LocalSnapshot =
  | { kind: "ready"; today: string; notes: DailyNote[]; tasks: LocalTask[]; changedAt: number }
  | { kind: "unavailable"; reason: string };

const NoteDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const LocalMoveSchema = z.object({ date: NoteDateSchema, line: z.number().int().nonnegative(), raw: z.string(), to: LocalStateSchema });
export const LocalBlockSchema = z.object({ date: NoteDateSchema, line: z.number().int().nonnegative(), block: z.string(), next: z.string() });
export type LocalMove = z.infer<typeof LocalMoveSchema>;
export type LocalBlockEdit = z.infer<typeof LocalBlockSchema>;

export const LINEAR_COLUMNS = ["todo", "progress", "review", "done"] as const;
export type LinearColumn = (typeof LINEAR_COLUMNS)[number];

export type LinearPriority = "none" | "urgent" | "high" | "medium" | "low";

export type LinearIssue = {
  id: string;
  identifier: string;
  title: string;
  url: string;
  description: string;
  priority: LinearPriority;
  column: LinearColumn;
  stateName: string;
  team: { id: string; key: string; name: string };
  assignee: { name: string; isMe: boolean } | null;
  creator: { name: string; isMe: boolean } | null;
  cycle: { number: number; endsAt: string } | null;
  links: TaskLink[];
  updatedAt: string;
};

export type LinearSnapshot =
  | { kind: "ready"; issues: LinearIssue[]; fetchedAt: number }
  | { kind: "unavailable"; reason: string };

export const LinearMoveSchema = z.object({ id: z.string(), to: z.enum(LINEAR_COLUMNS) });
export type LinearMove = z.infer<typeof LinearMoveSchema>;

export const GITHUB_COLUMNS = ["open", "progress", "closed"] as const;
export type GithubColumn = (typeof GITHUB_COLUMNS)[number];

export type GithubIssue = {
  id: string;
  repo: string;
  number: number;
  title: string;
  url: string;
  body: string;
  column: GithubColumn;
  labels: { name: string; color: string }[];
  author: string;
  assignedToMe: boolean;
  createdByMe: boolean;
  comments: number;
  pullRequests: { repo: string; number: number; url: string; state: PrState }[];
  links: TaskLink[];
  closedAt: string | null;
  updatedAt: string;
};

export type GithubSnapshot =
  | { kind: "ready"; issues: GithubIssue[]; fetchedAt: number }
  | { kind: "unavailable"; reason: string };

export const GithubMoveSchema = z.object({ id: z.string(), to: z.enum(["open", "closed"]) });
export type GithubMove = z.infer<typeof GithubMoveSchema>;

export const PRIORITY_REASONS = ["customer", "in flight", "ai core", "unblocks", "hygiene"] as const;
export type PriorityReason = (typeof PRIORITY_REASONS)[number];

export const PriorityItemSchema = z.object({
  source: z.enum(TASK_SOURCES),
  id: z.string(),
  ref: z.string(),
  title: z.string(),
  score: z.number(),
  reason: z.enum(PRIORITY_REASONS),
});
export type PriorityItem = z.infer<typeof PriorityItemSchema>;

export type PrioritySnapshot = RankingSnapshot<PriorityItem>;

export type TaskOrders = Record<TaskSource, string[]>;
export const TaskOrderSchema = z.object({ source: z.enum(TASK_SOURCES), keys: z.array(z.string().max(1000)).max(5000) });
export type TaskOrder = z.infer<typeof TaskOrderSchema>;
