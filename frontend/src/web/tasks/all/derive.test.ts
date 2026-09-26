import { expect, test } from "bun:test";
import type { GithubIssue, LinearIssue, LocalTask } from "@/shared/tasks";
import { columnOf, combine, inAllRange, keyOf, moveOf } from "./derive";

const local = (state: LocalTask["state"]): LocalTask => ({ id: `2026-09-24:${state}`, date: "2026-09-24", line: 3, state, title: state, raw: "- [ ] x", links: [], subtasks: { done: 0, total: 0 }, block: "" });

const linear = (column: LinearIssue["column"]): LinearIssue => ({
  id: `L-${column}`,
  identifier: "DB-1",
  title: column,
  url: "",
  description: "",
  priority: "none",
  column,
  stateName: column,
  team: { id: "t", key: "DB", name: "Databrain" },
  assignee: null,
  creator: null,
  cycle: null,
  links: [],
  updatedAt: "",
});

const github = (column: GithubIssue["column"], author = "me"): GithubIssue => ({
  id: `G-${column}-${author}`,
  repo: "o/r",
  number: 1,
  title: column,
  url: "",
  body: "",
  column,
  labels: [],
  author,
  assignedToMe: true,
  createdByMe: false,
  comments: 0,
  pullRequests: [],
  links: [],
  closedAt: null,
  updatedAt: "",
});

test("every source folds onto open, doing and done, with review and dropped riding along", () => {
  expect((["open", "doing", "done", "dropped"] as const).map(s => columnOf({ source: "local", task: local(s) }))).toEqual(["open", "doing", "done", "done"]);
  expect((["todo", "progress", "review", "done"] as const).map(c => columnOf({ source: "linear", task: linear(c) }))).toEqual(["open", "doing", "doing", "done"]);
  expect((["open", "progress", "closed"] as const).map(c => columnOf({ source: "github", task: github(c) }))).toEqual(["open", "doing", "done"]);
});

test("a drop becomes the owning source's own move", () => {
  expect(moveOf({ source: "local", task: local("open") }, "done")).toEqual({ source: "local", move: { date: "2026-09-24", line: 3, raw: "- [ ] x", to: "done" } });
  expect(moveOf({ source: "linear", task: linear("todo") }, "doing")).toEqual({ source: "linear", move: { id: "L-todo", to: "progress" } });
  expect(moveOf({ source: "github", task: github("open") }, "done")).toEqual({ source: "github", move: { id: "G-open-me", to: "closed" } });
});

test("github has no manual in progress, so dropping there is refused", () => {
  expect(moveOf({ source: "github", task: github("open") }, "doing")).toBeNull();
});

test("github issues mirrored from linear are left out so the work shows once", () => {
  const all = combine({ local: [local("open")], linear: [linear("todo")], github: [github("open"), github("open", "linear-bot")] }, "linear-bot");
  expect(all.map(keyOf)).toEqual(["local:2026-09-24:open", "linear:L-todo", "github:G-open-me"]);
});

test("with linear down the mirrors are the only copy, so they stay", () => {
  const all = combine({ local: [], linear: [], github: [github("open", "linear-bot")] }, null);
  expect(all.map(keyOf)).toEqual(["github:G-open-linear-bot"]);
});

test("the range reads a local task's note day and an issue's last update", () => {
  const today = "2026-09-25";
  const quiet = { ...linear("todo"), updatedAt: "2026-09-10T12:00:00Z" };
  const touched = { ...github("open"), updatedAt: "2026-09-25T12:00:00Z" };
  const tuesday = { ...local("open"), date: "2026-09-22" };
  const tasks = combine({ local: [tuesday], linear: [quiet], github: [touched] }, null);
  const keys = (range: "today" | "week" | "all") => tasks.filter(t => inAllRange(t, range, today)).map(t => t.source);
  expect(keys("today")).toEqual(["github"]);
  expect(keys("week")).toEqual(["local", "github"]);
  expect(keys("all")).toEqual(["local", "linear", "github"]);
});
