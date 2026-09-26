import type { GithubColumn, GithubIssue, GithubMove, LinearColumn, LinearIssue, LinearMove, LocalMove, LocalState, LocalTask } from "@/shared/tasks";
import { fromLinear } from "../github/meta";
import { inRange } from "../local/derive";
import type { AllRange } from "../store";

export type AnyTask = { source: "local"; task: LocalTask } | { source: "linear"; task: LinearIssue } | { source: "github"; task: GithubIssue };

export type AnyMove = { source: "local"; move: LocalMove } | { source: "linear"; move: LinearMove } | { source: "github"; move: GithubMove };

export type AllColumn = "open" | "doing" | "done";

const FROM_LOCAL: Record<LocalState, AllColumn> = { open: "open", doing: "doing", done: "done", dropped: "done" };
const FROM_LINEAR: Record<LinearColumn, AllColumn> = { todo: "open", progress: "doing", review: "doing", done: "done" };
const FROM_GITHUB: Record<GithubColumn, AllColumn> = { open: "open", progress: "doing", closed: "done" };
const TO_LOCAL: Record<AllColumn, LocalState> = { open: "open", doing: "doing", done: "done" };
const TO_LINEAR: Record<AllColumn, LinearColumn> = { open: "todo", doing: "progress", done: "done" };

export const keyOf = (t: AnyTask): string => `${t.source}:${t.task.id}`;

export function columnOf(t: AnyTask): AllColumn {
  switch (t.source) {
    case "local":
      return FROM_LOCAL[t.task.state];
    case "linear":
      return FROM_LINEAR[t.task.column];
    case "github":
      return FROM_GITHUB[t.task.column];
  }
}

export function moveOf(t: AnyTask, to: AllColumn): AnyMove | null {
  switch (t.source) {
    case "local":
      return { source: "local", move: { date: t.task.date, line: t.task.line, raw: t.task.raw, to: TO_LOCAL[to] } };
    case "linear":
      return { source: "linear", move: { id: t.task.id, to: TO_LINEAR[to] } };
    case "github":
      return to === "doing" ? null : { source: "github", move: { id: t.task.id, to: to === "done" ? "closed" : "open" } };
  }
}

export function combine(from: { local: readonly LocalTask[]; linear: readonly LinearIssue[]; github: readonly GithubIssue[] }, hideMirrorsOf: string | null): AnyTask[] {
  return [
    ...from.local.map(task => ({ source: "local" as const, task })),
    ...from.linear.map(task => ({ source: "linear" as const, task })),
    ...from.github.filter(i => hideMirrorsOf === null || !fromLinear(i, hideMirrorsOf)).map(task => ({ source: "github" as const, task })),
  ];
}

export const localDay = (iso: string): string => new Date(iso).toLocaleDateString("en-CA");

export const activityDay = (t: AnyTask): string => (t.source === "local" ? t.task.date : localDay(t.task.updatedAt));

export const inAllRange = (t: AnyTask, range: AllRange, today: string): boolean => inRange(activityDay(t), range === "today" ? { kind: "day", date: today } : { kind: range }, today);
