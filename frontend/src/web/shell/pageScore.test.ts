import { expect, test } from "bun:test";
import { pageScore } from "./pageScore";

test("every typed word must really appear, so scattered letters never match", () => {
  expect(pageScore("ship my prs", "later", ["ship", "my prs", "pull requests", "authored", "ready", "blocked"])).toBe(0);
  expect(pageScore("machines awsakato", "watch", ["machine", "host"])).toBe(0);
  expect(pageScore("ship all prs", "embed token", ["search", "org"])).toBe(0);
});

test("the page name outranks its keywords, and the whole phrase outranks separate words", () => {
  expect(pageScore("later read later", "later", ["later", "saved"])).toBe(1);
  expect(pageScore("ship my prs", "my prs", [])).toBe(1);
  expect(pageScore("tasks github issues", "issues github", [])).toBe(0.8);
  expect(pageScore("ship waiting on you", "review", ["review", "requested"])).toBe(0.5);
  expect(pageScore("ship all prs", "DatabrainHQ", ["databrainhq"])).toBe(0.5);
});

test("an empty search keeps everything", () => {
  expect(pageScore("machines fleet", "  ", [])).toBe(1);
});
