import { expect, test } from "bun:test";
import type { MiraiEvent } from "@/shared/mirai";
import { applyEvent, costLabel, sinceLabel, spentSince, splitRecords, startTurn, viewLabel } from "./live";

const play = (events: MiraiEvent[]) => events.reduce(applyEvent, startTurn(null, "is it green?", "ship / mine", 0));

test("a streamed answer builds up thinking, calls and text in order", () => {
  const turn = play([
    { type: "thread", threadId: "01abcdef-thread" },
    { type: "thinking", delta: "find " },
    { type: "thinking", delta: "the PR" },
    { type: "call", id: "c1", label: "read ship · pull requests", change: false },
    { type: "call", id: "c2", label: "$ rm -rf /tmp/x", change: true },
    { type: "call_end", id: "c1", ok: true },
    { type: "call_end", id: "c2", ok: false },
    { type: "text", delta: "#1873 has " },
    { type: "text", delta: "2 failing checks." },
  ]);
  expect(turn).toEqual(
    expect.objectContaining({
      threadId: "01abcdef-thread",
      thinking: "find the PR",
      calls: [
        { id: "c1", label: "read ship · pull requests", change: false, ok: true },
        { id: "c2", label: "$ rm -rf /tmp/x", change: true, ok: false },
      ],
      answer: "#1873 has 2 failing checks.",
      error: null,
    }),
  );
});

test("a retry drops the failed attempt's partial answer and shows until the model streams again", () => {
  const retrying = play([
    { type: "text", delta: "half an ans" },
    { type: "retry", attempt: 2, max: 3, delayMs: 4000, error: "429 rate limited" },
  ]);
  expect(retrying.retry).toBe("429 rate limited · retrying 2/3 in 4s");
  expect(retrying.answer).toBe("");
  expect(applyEvent(retrying, { type: "text", delta: "ok" }).retry).toBeNull();
});

test("records split on LF only, keep a partial tail, and tolerate CRLF", () => {
  expect(splitRecords('{"a":1}\r\n{"b":"x y"}\n{"c"')).toEqual({ records: ['{"a":1}', '{"b":"x y"}'], rest: '{"c"' });
});

test("the view names what is on screen for every module", () => {
  expect(viewLabel({ module: "machines", host: "omarikato" })).toBe("omarikato / host");
  expect(viewLabel({ module: "machines", host: null })).toBe("fleet");
  expect(viewLabel({ module: "tasks", board: "linear" })).toBe("tasks / linear");
  expect(viewLabel({ module: "ship", queue: "mine", review: "backend#1873" })).toBe("ship / backend#1873");
  expect(viewLabel({ module: "later", view: { by: "kind", kind: "watch" } })).toBe("content / watch");
  expect(viewLabel({ module: "stats" })).toBe("stats");
  expect(viewLabel({ module: "ship", queue: "review", review: null })).toBe("ship / review");
  expect(viewLabel({ module: "later", view: { by: "folder", folder: "rust" } })).toBe("content / folder rust");
  expect(viewLabel({ module: "later", view: { by: "kind", kind: "watch" } }, { id: "69e4798d-2ca3-40b9-9812-574ec0cfdd9d", title: "How Postgres row level security really works under load", kind: "watch" })).toBe(
    "content / watch · 69e4798d-2ca3-40b9-9812-574ec0cfdd9d · How Postgres row level security really works un…",
  );
  const inFolder = viewLabel({ module: "later", view: { by: "folder", folder: "0f3c9a52-7d1e-4b8a-9c61-2e5f8d4a7b30" } }, { id: "69e4798d-2ca3-40b9-9812-574ec0cfdd9d", title: "A title long enough to push the label past its cap", kind: "read" });
  expect(inFolder.length).toBe(120);
  expect(viewLabel({ module: "later", view: { by: "item", id: "abc" } }, { id: "abc", title: "Talk", kind: "watch" })).toBe("content / watch · abc · Talk");
  expect(inFolder).toContain("· 69e4798d-2ca3-40b9-9812-574ec0cfdd9d ·");
  expect(viewLabel({ module: "notes", target: "Daily/2026-09-26" })).toBe("notes / Daily/2026-09-26");
  expect(viewLabel({ module: "notes", target: null })).toBe("notes");
  expect(viewLabel({ module: "projects", view: "stack" })).toBe("projects / stack");
});

test("costs under half a cent keep three decimals", () => {
  expect(costLabel(0.0017)).toBe("$0.002");
  expect(costLabel(0.074)).toBe("$0.07");
});

test("elapsed time carries seconds into minutes", () => {
  expect(sinceLabel(400)).toBe("1s");
  expect(sinceLabel(59_600)).toBe("1m 0s");
  expect(sinceLabel(119_600)).toBe("2m 0s");
  expect(sinceLabel(125_000)).toBe("2m 5s");
});

test("spend counts only the turns inside the window", () => {
  expect(spentSince([{ at: 0, costUsd: 5 }, { at: 100, costUsd: 0.12 }], 50)).toBeCloseTo(0.12);
});
