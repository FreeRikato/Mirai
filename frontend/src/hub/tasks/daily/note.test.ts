import { expect, test } from "bun:test";
import { carryOver, parseNote, replaceBlock, setState } from "./note";

const NOTE = [
  "- [ ] Fix the issue - https://linear.app/databrain/issue/DEV-508/format-sql",
  "\t- [ ] Bump sql-formatter",
  "\t- [x] Editor owns the formatter",
  "- [/] Review sync PRs",
  "- [-] Understand hasura timeout",
  "- https://github.com/databrainhq/backend/pull/3862",
  "- https://github.com/databrainhq/backend/pull/3866",
  "- [x] Create jam skill",
  "- [>] Carried away",
].join("\n");

test("top-level tasks become cards with state, clean title, subtasks and links from their block", () => {
  const { tasks } = parseNote("2026-09-23", NOTE);
  expect(tasks.map(t => [t.line, t.state, t.title])).toEqual([
    [0, "open", "Fix the issue"],
    [3, "doing", "Review sync PRs"],
    [4, "dropped", "Understand hasura timeout"],
    [7, "done", "Create jam skill"],
  ]);
  expect(tasks[0]?.subtasks).toEqual({ done: 1, total: 2 });
  expect(tasks[0]?.links[0]).toMatchObject({ kind: "linear", id: "DEV-508" });
  expect(tasks[0]?.block.split("\n")).toHaveLength(3);
  expect(tasks[2]?.links.map(l => (l.kind === "pr" ? l.number : null))).toEqual([3862, 3866]);
  expect(tasks[0]?.id).toBe("2026-09-23:0");
});

test("counts include nested tasks and skip carried ones", () => {
  expect(parseNote("2026-09-23", NOTE).counts).toEqual({ open: 2, doing: 1, done: 2, dropped: 1 });
});

test("a task nested under a plain bullet is still a card", () => {
  const { tasks } = parseNote("d", "- Project\n  - [ ] ship it");
  expect(tasks.map(t => t.title)).toEqual(["ship it"]);
});

test("moving a task rewrites only its checkbox, and refuses when the line changed underneath", () => {
  const out = setState(NOTE, 3, "- [/] Review sync PRs", "done");
  expect(out.ok && out.text.split("\n")[3]).toBe("- [x] Review sync PRs");
  expect(out.ok && out.text.split("\n").filter((l, i) => i !== 3)).toEqual(NOTE.split("\n").filter((l, i) => i !== 3));
  expect(setState(NOTE, 3, "- [/] something else", "done").ok).toBe(false);
});

test("editing a block replaces exactly its lines, and refuses when the block changed underneath", () => {
  const { tasks } = parseNote("d", NOTE);
  const block = tasks[0]?.block ?? "";
  const out = replaceBlock(NOTE, 0, block, "- [ ] Fix the issue\n\t- [x] all done");
  expect(out.ok && out.text.split("\n").slice(0, 3)).toEqual(["- [ ] Fix the issue", "\t- [x] all done", "- [/] Review sync PRs"]);
  expect(replaceBlock(NOTE, 0, "stale", "x").ok).toBe(false);
});

test("carrying copies unfinished blocks from the last week into today and marks the originals as carried", () => {
  const out = carryOver(
    [
      { date: "2026-09-22", text: "- [ ] old open\n\t- [x] sub\n- [x] finished" },
      { date: "2026-09-23", text: NOTE },
      { date: "2026-09-10", text: "- [ ] too old" },
    ],
    "2026-09-24",
    7,
  );
  expect(out.today.split("\n")).toEqual(["- [ ] old open", "\t- [x] sub", ...NOTE.split("\n").slice(0, 4)]);
  expect(out.updated.map(u => [u.date, u.text.split("\n")[0]])).toEqual([
    ["2026-09-22", "- [>] old open"],
    ["2026-09-23", "- [>] Fix the issue - https://linear.app/databrain/issue/DEV-508/format-sql"],
  ]);
  expect(out.updated[1]?.text.split("\n")[3]).toBe("- [>] Review sync PRs");
});

test("subtasks of a carried task stay with it: they are not cards and are never carried on their own", () => {
  const yesterday = "- [>] Fix synthetic queries\n\t- [/] Handle out of credits\n\t- [ ] Migrate call sites\n- [ ] Review PRs";
  expect(parseNote("2026-09-24", yesterday).tasks.map(t => t.title)).toEqual(["Review PRs"]);
  expect(carryOver([{ date: "2026-09-24", text: yesterday }], "2026-09-25", 7).today).toBe("- [ ] Review PRs");
});
