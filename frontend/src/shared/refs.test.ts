import { expect, test } from "bun:test";
import { parsePeek, peekOf, peekParam } from "./refs";

test("pull requests and issues peek as one github ref, linear tickets by identifier", () => {
  expect(peekOf("https://github.com/databrainhq/backend/pull/9/files")).toEqual({ kind: "github", repo: "databrainhq/backend", number: 9 });
  expect(peekOf("https://github.com/databrainhq/backend/issues/3698")).toEqual({ kind: "github", repo: "databrainhq/backend", number: 3698 });
  expect(peekOf("https://linear.app/databrain/issue/DBN-123/fix-the-thing")).toEqual({ kind: "linear", id: "DBN-123" });
  expect(peekOf("https://github.com/databrainhq/backend/actions/runs/1")).toBeNull();
  expect(peekOf("https://example.com/pull/1")).toBeNull();
});

test("a peek survives the round trip through the url", () => {
  for (const peek of [{ kind: "github", repo: "databrainhq/frontend-mono", number: 8276 }, { kind: "linear", id: "DBN-7" }] as const) {
    expect(parsePeek(peekParam(peek))).toEqual(peek);
  }
  expect(parsePeek(null)).toBeNull();
  expect(parsePeek("not a ref")).toBeNull();
  expect(parsePeek("a/b/c/1")).toBeNull();
});
