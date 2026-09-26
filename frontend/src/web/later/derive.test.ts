import { expect, test } from "bun:test";
import type { LaterItem } from "@/shared/later";
import { placed, rateFor, skipAt, timeLeft, budgetCounts, extractUrl, extractUrls, fitRate, folderItems, isStale, kindCounts, leftLabel, lengthLabel, siteCounts, step, stepRate, upNext, visible, LATER_QUEUES } from "./derive";

const item = (id: string, over: Partial<LaterItem> = {}): LaterItem => ({
  id,
  url: `https://${id}.dev/`,
  kind: "read",
  embed: { type: "article" },
  title: `title ${id}`,
  site: `${id}.dev`,
  author: null,
  image: null,
  lengthSec: 600,
  progress: 0,
  position: 0,
  state: "unread",
  worth: "full",
  tldr: [],
  chapters: [],
  folder: null,
  savedAt: 0,
  queueOrder: over.savedAt ?? 0,
  ...over,
});

const items = [
  item("rls", { title: "How Postgres RLS works", lengthSec: 840, state: "progress", progress: 0.5 }),
  item("agents", { lengthSec: 660, tldr: ["start with workflows"] }),
  item("pdf", { embed: { type: "pdf" }, lengthSec: null }),
  item("old", { state: "done" }),
  item("talk", { kind: "watch", lengthSec: 1930 }),
  item("gone", { state: "archived" }),
];

const base = { kind: "read", queue: "queue", budget: null, site: null, text: "" } as const;

test("the unread queue holds unread and in-progress items of the chosen kind", () => {
  expect(visible(items, base).map(i => i.id)).toEqual(["rls", "agents", "pdf"]);
  expect(visible(items, { ...base, queue: "done" }).map(i => i.id)).toEqual(["old"]);
  expect(LATER_QUEUES).toEqual(["queue", "done", "archived"]);
  expect(visible(items, { ...base, kind: "watch" }).map(i => i.id)).toEqual(["talk"]);
});

test("a time budget counts only what is left and drops items of unknown length", () => {
  expect(visible(items, { ...base, budget: 10 }).map(i => i.id)).toEqual(["rls"]);
  expect(budgetCounts(items, "read", "queue")).toEqual({ "10": 1, "30": 2, "60": 2, all: 3 });
});

test("text filter searches title, site and tl;dr; site filter narrows to one host", () => {
  expect(visible(items, { ...base, text: "postgres" }).map(i => i.id)).toEqual(["rls"]);
  expect(visible(items, { ...base, text: "workflows" }).map(i => i.id)).toEqual(["agents"]);
  expect(visible(items, { ...base, site: "pdf.dev" }).map(i => i.id)).toEqual(["pdf"]);
});

test("counts per kind, queue and site", () => {
  expect(kindCounts(items)).toEqual({ read: 3, watch: 1 });
  expect(siteCounts(items, "read", "queue")).toEqual([["agents.dev", 1], ["pdf.dev", 1], ["rls.dev", 1]]);
});

test("up next fills the budget in order and lists the rest as over budget", () => {
  const [current] = items;
  if (!current) throw new Error("fixture");
  const plan = upNext(items, current, 30);
  expect(plan.next.map(i => i.id)).toEqual(["agents"]);
  expect(plan.over.map(i => i.id)).toEqual(["pdf"]);
  expect(upNext(items, current, null).next.map(i => i.id)).toEqual(["agents", "pdf"]);
});

test("stale means unread and older than the limit", () => {
  const day = 86_400_000;
  expect(isStale(item("a", { savedAt: 0 }), 31 * day, 30)).toBe(true);
  expect(isStale(item("a", { savedAt: 0, state: "progress" }), 31 * day, 30)).toBe(false);
  expect(isStale(item("a", { savedAt: 2 * day }), 31 * day, 30)).toBe(false);
});

test("labels read as minutes and watch as a clock", () => {
  expect(lengthLabel(item("a", { lengthSec: 840 }))).toBe("14 min");
  expect(lengthLabel(item("a", { kind: "watch", lengthSec: 3730 }))).toBe("1:02:10");
  expect(lengthLabel(item("a", { lengthSec: null, embed: { type: "pdf" } }))).toBe("pdf");
  expect(leftLabel(item("a", { lengthSec: 840, progress: 0.5 }))).toBe("7 min left");
  expect(leftLabel(item("a", { kind: "watch", lengthSec: 1930, progress: 0.5 }))).toBe("16:05 left");
  expect(leftLabel(item("a"))).toBeNull();
});

test("step clamps at the ends and starts from the edge with nothing selected", () => {
  expect(step(["a", "b"], null, 1)).toBe("a");
  expect(step(["a", "b"], null, -1)).toBe("b");
  expect(step(["a", "b"], "b", 1)).toBe("b");
  expect(step([], "a", 1)).toBeNull();
});

test("extractUrl finds a link inside shared text and trims trailing punctuation", () => {
  expect(extractUrl("Check this out: https://samwho.dev/memory-allocation/.")).toBe("https://samwho.dev/memory-allocation/");
  expect(extractUrl("https://youtu.be/abcdefghijk")).toBe("https://youtu.be/abcdefghijk");
  expect(extractUrl("no link here")).toBeNull();
});

test("a speed the player can't do falls back to the fastest one it can", () => {
  const youtube = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
  expect(fitRate(3, youtube)).toBe(2);
  expect(fitRate(1.5, youtube)).toBe(1.5);
  expect(fitRate(0.25, youtube)).toBe(0.5);
});

test("stepping speed walks the player's own rates and stops at either end", () => {
  const youtube = [0.5, 1, 2];
  expect(stepRate(1, youtube, 1)).toBe(2);
  expect(stepRate(2, youtube, 1)).toBe(2);
  expect(stepRate(3, youtube, -1)).toBe(1);
  expect(stepRate(0.5, youtube, -1)).toBe(0.5);
});

test("extractUrls splits pasted links on commas, spaces and new lines and keeps commas inside a link", () => {
  expect(extractUrls("https://a.dev/1, https://b.dev/2,https://c.dev/3\nhttps://d.dev/4")).toEqual(["https://a.dev/1", "https://b.dev/2", "https://c.dev/3", "https://d.dev/4"]);
  expect(extractUrls("see https://maps.dev/?ll=1,2 and https://a.dev/1.")).toEqual(["https://maps.dev/?ll=1,2", "https://a.dev/1"]);
  expect(extractUrls("https://a.dev/1, https://a.dev/1")).toEqual(["https://a.dev/1"]);
  expect(extractUrls("just words, no links")).toEqual([]);
});

const rls = { id: "rls-folder", order: 0 };
const grouped = [...items, item("deep", { folder: { ...rls, order: 2 }, state: "done" }), item("first", { folder: { ...rls, order: 1 }, kind: "watch" }), item("elsewhere", { folder: { id: "other", order: 1 } })];

test("items in a folder stay out of the queues, counts and stale list", () => {
  expect(visible(grouped, base).map(i => i.id)).toEqual(["rls", "agents", "pdf"]);
  expect(visible(grouped, { ...base, queue: "done" }).map(i => i.id)).toEqual(["old"]);
  expect(kindCounts(grouped)).toEqual(kindCounts(items));
  expect(siteCounts(grouped, "read", "queue")).toEqual(siteCounts(items, "read", "queue"));
  expect(isStale(item("x", { folder: rls }), 99 * 86_400_000, 30)).toBe(false);
});

test("a folder lists both kinds in its own order, and up next follows that order", () => {
  expect(folderItems(grouped, rls.id).map(i => i.id)).toEqual(["first", "deep"]);
  const first = grouped.find(i => i.id === "first");
  expect(first && upNext(grouped, first, 10).next.map(i => i.id)).toEqual(["deep"]);
});

test("placing an id before or after another moves only that id", () => {
  const ids = ["a", "b", "c", "d"];
  expect(placed(ids, "a", "c", "after")).toEqual(["b", "c", "a", "d"]);
  expect(placed(ids, "d", "b", "before")).toEqual(["a", "d", "b", "c"]);
  expect(placed(ids, "b", "c", "before")).toEqual(ids);
  expect(placed(ids, "b", "b", "after")).toEqual(ids);
  expect(placed(ids, "x", "b", "after")).toEqual(ids);
});

test("a skip fires only when playback runs into it, not when you seek or resume inside it", () => {
  const skips = [
    { start: 0, end: 40, category: "intro" as const },
    { start: 96.6, end: 150, category: "sponsor" as const },
  ];
  expect(skipAt(skips, 0, 0.5)?.category).toBe("intro");
  expect(skipAt(skips, 95.9, 96.9)?.category).toBe("sponsor");
  expect(skipAt(skips, 96.6, 97.1)?.category).toBe("sponsor");
  expect(skipAt(skips, 10, 10.5)).toBeNull();
  expect(skipAt(skips, 20, 100)).toBeNull();
  expect(skipAt(skips, 96.9, 96.9)).toBeNull();
  expect(skipAt(skips, 150, 151)).toBeNull();
});

test("time left at your speed counts only what plays faster, capping youtube at 2x", () => {
  const yt = item("yt", { kind: "watch", embed: { type: "youtube", videoId: "aaaaaaaaaaa" }, lengthSec: 3600, progress: 0.5 });
  const file = item("file", { kind: "watch", embed: { type: "video" }, lengthSec: 3600 });
  const read = item("read", { lengthSec: 600 });
  expect(rateFor(yt, 3)).toBe(2);
  expect(rateFor(file, 3)).toBe(3);
  expect(rateFor(read, 3)).toBe(1);
  expect(timeLeft([yt, read], 2)).toEqual({ sec: 2400, atSpeed: 1500, rate: 2 });
  expect(timeLeft([yt, file], 3)).toEqual({ sec: 5400, atSpeed: 2100, rate: 3 });
  expect(timeLeft([read], 2)).toEqual({ sec: 600, atSpeed: 600, rate: 1 });
});
