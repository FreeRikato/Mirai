import { expect, test } from "bun:test";
import type { Fetched } from "./ingest";
import { createSkips } from "./skips";

const SEGMENTS = [
  { category: "selfpromo", actionType: "skip", segment: [586.19, 609.47] },
  { category: "sponsor", actionType: "skip", segment: [96.6, 145.6] },
  { category: "sponsor", actionType: "skip", segment: [140, 150] },
  { category: "sponsor", actionType: "mute", segment: [300, 310] },
  { category: "poi_highlight", actionType: "poi", segment: [400, 400] },
];

function setup(reply: () => Fetched | null) {
  let clock = 0;
  const asked: string[] = [];
  const skips = createSkips({
    ttlMs: 1_000,
    now: () => clock,
    fetchText: async url => {
      asked.push(url);
      return reply();
    },
  });
  return { skips, asked, tick: (ms: number) => (clock += ms) };
}

test("keeps only skippable segments, sorted, with overlapping ones merged, and asks once per video until the cache expires", async () => {
  const { skips, asked, tick } = setup(() => ({ status: 200, contentType: "application/json", body: JSON.stringify(SEGMENTS) }));
  expect(await skips("BHPDsGVciDk")).toEqual([
    { start: 96.6, end: 150, category: "sponsor" },
    { start: 586.19, end: 609.47, category: "selfpromo" },
  ]);
  await skips("BHPDsGVciDk");
  expect(asked).toHaveLength(1);
  expect(asked[0]).toContain("videoID=BHPDsGVciDk");
  tick(1_001);
  await skips("BHPDsGVciDk");
  expect(asked).toHaveLength(2);
});

test("a video nobody has marked has no skips, and an outage is not remembered", async () => {
  expect(await setup(() => ({ status: 404, contentType: "text/plain", body: "Not Found" })).skips("aaaaaaaaaaa")).toEqual([]);
  const down = setup(() => null);
  expect(await down.skips("aaaaaaaaaaa")).toEqual([]);
  await down.skips("aaaaaaaaaaa");
  expect(down.asked).toHaveLength(2);
});
