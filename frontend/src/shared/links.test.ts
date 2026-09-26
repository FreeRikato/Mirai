import { expect, test } from "bun:test";
import { classifyUrl, extractLinks, linkRefs } from "./links";

test("classifies linear, pull request, issue, jam and plain urls", () => {
  expect(classifyUrl("https://linear.app/databrain/issue/DEV-508/format-sql")).toEqual({ kind: "linear", url: "https://linear.app/databrain/issue/DEV-508/format-sql", id: "DEV-508" });
  expect(classifyUrl("https://github.com/databrainhq/backend/pull/3862")).toEqual({ kind: "pr", url: "https://github.com/databrainhq/backend/pull/3862", repo: "databrainhq/backend", number: 3862 });
  expect(classifyUrl("https://github.com/databrainhq/backend/issues/3698#issuecomment-1")).toMatchObject({ kind: "issue", repo: "databrainhq/backend", number: 3698 });
  expect(classifyUrl("https://jam.dev/c/509d3f58-b7b2-431b-9698-532ec6b5f5cf")).toMatchObject({ kind: "jam", id: "509d3f58" });
  expect(classifyUrl("https://www.example.com/a")).toMatchObject({ kind: "url", host: "example.com" });
});

test("pulls bare and markdown links out of task text and keeps the words", () => {
  const out = extractLinks("Fix the issue - https://linear.app/databrain/issue/DEV-508/x and [the PR](https://github.com/o/r/pull/1)");
  expect(out.title).toBe("Fix the issue and the PR");
  expect(out.links.map(l => l.kind)).toEqual(["linear", "pr"]);
});

test("a line that is only a link leaves an empty title and trailing punctuation off the url", () => {
  const out = extractLinks("https://github.com/o/r/pull/7).");
  expect(out.title).toBe("");
  expect(out.links[0]).toMatchObject({ kind: "pr", number: 7 });
});

test("the same url twice is one link", () => {
  expect(extractLinks("https://a.dev/x https://a.dev/x").links).toHaveLength(1);
});

test("a dash between words stays; only the one introducing a link goes", () => {
  expect(extractLinks("Audit PRs - refusals as results").title).toBe("Audit PRs - refusals as results");
});

test("owner/repo#123 references stay in the text and become links", () => {
  const out = extractLinks("fixed in databrainhq/frontend-mono#8276, not in https://github.com/o/r#readme");
  expect(out.title).toBe("fixed in databrainhq/frontend-mono#8276, not in");
  expect(out.links.map(l => l.url)).toEqual(["https://github.com/o/r#readme", "https://github.com/databrainhq/frontend-mono/issues/8276"]);
});

test("issue references in markdown become links to github, but not inside code, links or urls", () => {
  const repo = "databrainhq/backend";
  expect(linkRefs("Do not merge until #3390 and frontend-mono#7920, see databrainhq/app#5.", repo)).toBe(
    "Do not merge until [#3390](https://github.com/databrainhq/backend/issues/3390) and frontend-mono#7920, see [databrainhq/app#5](https://github.com/databrainhq/app/issues/5).",
  );
  expect(linkRefs("(#12)", repo)).toBe("([#12](https://github.com/databrainhq/backend/issues/12))");
  const untouched = "`#1` [#2](https://x.dev) https://x.dev/page#3 a#4\n```\n#5\n```\n## 6";
  expect(linkRefs(untouched, repo)).toBe(untouched);
});
