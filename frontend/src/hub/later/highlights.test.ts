import { expect, test } from "bun:test";
import { openDb } from "../db";
import { laterItems } from "../db/schema";
import { createHighlights } from "./highlights";

function setup() {
  const db = openDb(":memory:");
  let t = 1000;
  const now = () => ++t;
  db.insert(laterItems).values({ id: "item", url: "https://x.dev", kind: "read", embed: "{}", title: "t", site: "x.dev", worth: "full", tldr: "[]", chapters: "[]", savedAt: 1, updatedAt: 1 }).run();
  return createHighlights({ db, now });
}

test("highlights are listed per item in the order they were made", () => {
  const h = setup();
  h.add("item", { quote: "second pass", prefix: "a ", suffix: " b", note: "" });
  h.add("item", { quote: "first pass", prefix: "", suffix: "", note: "why" });
  expect(h.list("item").map(x => [x.quote, x.note])).toEqual([
    ["second pass", ""],
    ["first pass", "why"],
  ]);
  expect(h.list("other")).toEqual([]);
});

test("a note can be changed or cleared, and a highlight removed", () => {
  const h = setup();
  const made = h.add("item", { quote: "q", prefix: "", suffix: "", note: "old" });
  expect(h.setNote(made.id, "new")?.note).toBe("new");
  expect(h.setNote(made.id, "")?.note).toBe("");
  expect(h.remove(made.id)).toBe(true);
  expect(h.remove(made.id)).toBe(false);
  expect(h.setNote(made.id, "gone")).toBeNull();
  expect(h.list("item")).toEqual([]);
});

test("a video note keeps the second it was taken at, and article highlights have none", () => {
  const h = setup();
  h.add("item", { quote: "14:52", prefix: "", suffix: "", note: "batching across racks", at: 892 });
  h.add("item", { quote: "passage", prefix: "", suffix: "", note: "" });
  expect(h.list("item").map(x => [x.note, x.at])).toEqual([
    ["batching across racks", 892],
    ["", null],
  ]);
});
