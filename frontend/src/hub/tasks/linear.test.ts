import { expect, test } from "bun:test";
import { columnOf, stateFor, toIssue } from "./linear";

const states = [
  { id: "arc", name: "Archive", type: "backlog", position: 0 },
  { id: "bl", name: "Backlog", type: "backlog", position: 1 },
  { id: "todo", name: "Todo", type: "unstarted", position: 2 },
  { id: "ip", name: "In Progress", type: "started", position: 3 },
  { id: "rtm", name: "Ready to merge main", type: "completed", position: 4 },
  { id: "x", name: "Canceled", type: "canceled", position: 5 },
  { id: "dev", name: "In Develop", type: "started", position: 6 },
  { id: "rtt", name: "In Develop, ready to test", type: "started", position: 7 },
];

test("the first started state is in progress, every later started state is review", () => {
  expect(states.map(s => columnOf(s, states))).toEqual(["todo", "todo", "todo", "progress", "done", null, "review", "review"]);
});

test("a drop picks the matching team state, preferring Todo over Backlog", () => {
  expect(stateFor(states, "todo")?.id).toBe("todo");
  expect(stateFor(states, "progress")?.id).toBe("ip");
  expect(stateFor(states, "review")?.id).toBe("dev");
  expect(stateFor(states, "done")?.id).toBe("rtm");
  expect(stateFor(states.filter(s => s.id !== "dev" && s.id !== "rtt"), "review")).toBeNull();
});

test("an issue gathers links from attachments and its description, without linking to itself", () => {
  const issue = toIssue(
    {
      id: "1",
      identifier: "DEV-508",
      title: "Format SQL",
      url: "https://linear.app/databrain/issue/DEV-508/format-sql",
      description: "See https://github.com/databrainhq/react/pull/12 and https://linear.app/databrain/issue/DEV-508/format-sql",
      priority: 2,
      updatedAt: "2026-09-24T00:00:00Z",
      state: states[3] ?? { id: "", name: "", type: "", position: 0 },
      team: { id: "t", key: "DEV", name: "Development" },
      assignee: { name: "me", isMe: true },
      creator: null,
      cycle: null,
      attachments: { nodes: [{ url: "https://github.com/databrainhq/react/pull/12" }] },
    },
    states,
  );
  expect(issue?.column).toBe("progress");
  expect(issue?.priority).toBe("high");
  expect(issue?.links).toEqual([{ kind: "pr", url: "https://github.com/databrainhq/react/pull/12", repo: "databrainhq/react", number: 12 }]);
});
