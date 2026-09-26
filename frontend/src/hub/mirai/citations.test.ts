import { expect, test } from "bun:test";
import type { LaterItem } from "@/shared/later";
import { checkCitations, type CitationSources } from "./citations";

const base: LaterItem = { id: "v", url: "https://www.youtube.com/watch?v=abc", kind: "watch", embed: { type: "youtube", videoId: "abc" }, title: "CockroachDB", site: "youtube.com", author: null, image: null, lengthSec: 4094, progress: 0, position: 0, state: "unread", worth: "full", tldr: [], chapters: [], folder: null, queueOrder: 1, savedAt: 0 };
const items: Record<string, { item: LaterItem; content: string | null }> = {
  v: { item: base, content: null },
  queued: { item: { ...base, id: "queued", embed: { type: "youtube", videoId: "later" } }, content: null },
  plain: { item: { ...base, id: "plain", embed: { type: "video" }, lengthSec: 600 }, content: null },
  unsized: { item: { ...base, id: "unsized", embed: { type: "video" }, lengthSec: null }, content: null },
  vimeo: { item: { ...base, id: "vimeo", embed: { type: "vimeo", videoId: "9" } }, content: null },
  a: { item: { ...base, id: "a", kind: "read", embed: { type: "article" } }, content: "<p>Policies are <em>inlined</em>, into the plan &amp; costed (in Postgres) before planning.</p>" },
  pdf: { item: { ...base, id: "pdf", kind: "read", embed: { type: "pdf" } }, content: null },
};
const src: CitationSources = { item: id => items[id] ?? null, segments: id => (id === "abc" ? [{ start: 1670.4, end: 1675, text: "hybrid logical clocks" }] : null) };
const verdicts = (answer: string) => checkCitations(answer, src).map(c => [c.key.replaceAll("\n", " | "), c.status, c.reason]);

test("each cited moment is checked against the transcript, or left unchecked when there is nothing to check yet", () => {
  expect(verdicts("[▶ 27:51](/content/item/v?t=1671) [▶ 63:02](/content/item/v?t=3782) [▶ 1:00](/content/item/queued?t=60) [▶ 9:00](/content/item/plain?t=540) [▶ 11:00](/content/item/plain?t=660) [▶ 1:00](/content/item/unsized?t=60) [▶ 1:00](/content/item/vimeo?t=60) [▶ 1:00](/content/item/a?t=60) [▶ ?](/content/item/v?t=1e3)")).toEqual([
    ["v | moment | 1671", "ok", null],
    ["v | moment | 3782", "failed", "not in transcript"],
    ["queued | moment | 60", "unchecked", "transcript not ready"],
    ["plain | moment | 540", "ok", null],
    ["plain | moment | 660", "failed", "past the end of the video"],
    ["unsized | moment | 60", "unchecked", "video length unknown"],
    ["vimeo | moment | 60", "failed", "this player cannot jump"],
    ["a | moment | 60", "failed", "not a video"],
    ["v | malformed | malformed timestamp", "failed", "malformed timestamp"],
  ]);
});

test("each cited passage must be 5 to 15 words found in the article, even across tags, entities and parentheses", () => {
  expect(verdicts("[a](/content/item/a?q=inlined%2C%20into%20the%20plan%20%26amp%3B%20costed%20(in%20Postgres)) [b](/content/item/a?q=a%203x%20slowdown%20on%20the%20embed%20query) [c](/content/item/a?q=inlined) [d](/content/item/pdf?q=one%20two%20three%20four%20five) [e](<" + "/content/item/a?q=into the plan %26 costed (in Postgres)" + ">)")).toEqual([
    ["a | passage | inlined, into the plan &amp; costed (in Postgres)", "ok", null],
    ["a | passage | a 3x slowdown on the embed query", "failed", "not in the article"],
    ["a | passage | inlined", "failed", "quote too short"],
    ["pdf | passage | one two three four five", "failed", "no article text"],
    ["a | passage | into the plan & costed (in Postgres)", "ok", null],
  ]);
});

test("plain mentions, reference links, repeats and removed items are all checked once", () => {
  expect(verdicts("See [CockroachDB][cr] and [again](/content/item/v) and [gone](/content/item/gone?t=5), not [omarikato](/machines/omarikato).\n\n[cr]: /content/item/v")).toEqual([
    ["v | item | ", "ok", null],
    ["gone | moment | 5", "failed", "item removed"],
  ]);
});
