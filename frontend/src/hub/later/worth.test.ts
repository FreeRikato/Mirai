import { expect, test } from "bun:test";
import { z } from "zod";
import { WorthItemSchema, type LaterItem } from "@/shared/later";
import { openDb } from "../db";
import type { Jev, JevAnswer } from "../jev";
import { createRankingStore, RANKING_ROWS } from "../ranking";
import type { Ingested } from "./ingest";
import { createLaterStore } from "./store";
import { createWorth, evidenceOf, factsOf, rankWorth } from "./worth";

const NOW = Date.parse("2026-09-25T12:00:00Z");
const DAY = 86_400_000;

const item = (over: Partial<LaterItem> & Pick<LaterItem, "id" | "title">): LaterItem => ({
  url: `https://${over.id}.dev`,
  kind: "read",
  embed: { type: "article" },
  site: `${over.id}.dev`,
  author: null,
  image: null,
  lengthSec: 600,
  progress: 0,
  position: 0,
  state: "unread",
  worth: "unscored",
  tldr: [],
  chapters: [],
  folder: null,
  savedAt: NOW - 3 * DAY,
  queueOrder: over.savedAt ?? NOW - 3 * DAY,
  ...over,
});

const WORK = { tickets: ["DAT-881: semantic cache per tenant"], pullRequests: ["feat(agent): chart tool streaming"] };

test("an article is judged on its readable text, a video on its chapters and description", () => {
  const article = factsOf({ item: item({ id: "rls", title: "RLS", tldr: ["ignored when there is content"] }), content: `<h2>Plans</h2><p>${"policy ".repeat(400)}</p>` }, NOW);
  expect(article).toMatchObject({ title: "RLS", format: "article", minutes: 10, days_since_saved: 3 });
  expect(String(article.text).startsWith("Plans policy policy")).toBe(true);
  expect(String(article.text).length).toBe(1501);

  const talk = item({ id: "talk", title: "Intro to LLMs", kind: "watch", embed: { type: "youtube", videoId: "x" }, progress: 0.42, tldr: ["A busy person's intro."], chapters: [{ at: 0, title: "Inference" }, { at: 60, title: "Training" }] });
  expect(factsOf({ item: talk, content: null }, NOW)).toMatchObject({ kind: "watch", percent_done: 42, chapters: ["Inference", "Training"], text: "A busy person's intro." });
  expect(evidenceOf({ item: { ...talk, author: "Andrej Karpathy", site: "youtube.com" }, content: null }, NOW)).toEqual([
    "Andrej Karpathy · youtube.com",
    "10 min",
    "42% watched",
    "saved 3d ago",
    "2 chapters",
  ]);
});

const SentSchema = z.object({ current_work: z.unknown(), saved_items: z.array(z.object({ key: z.string(), title: z.string() })) });

function fakeJev(byTitle: Record<string, [number, string, string]>, seen: unknown[] = []): Jev {
  return async state => {
    const sent = SentSchema.parse(state);
    seen.push(sent.current_work);
    const answers = Object.fromEntries(
      sent.saved_items.flatMap(({ key, title }) => {
        const [score, why, verdict] = byTitle[title] ?? [0, "stale", "archive"];
        const value: JevAnswer = { type: "score", score, confidence: 1 };
        const reason: JevAnswer = { type: "choice", choice: why, confidence: 1 };
        const cut: JevAnswer = { type: "choice", choice: verdict, confidence: 1 };
        return [[`value_${key}`, value], [`why_${key}`, reason], [`verdict_${key}`, cut]];
      }),
    );
    return { answers, costUsd: 0.001 };
  };
}

test("rank sends current work, drops answers outside the lists, and puts the most valuable first", async () => {
  const seen: unknown[] = [];
  const judged = ["a", "b", "c"].map(title => ({ item: item({ id: title, title }), content: null }));
  const jev = fakeJev({ a: [1, "fun", "skim"], b: [2.8, "ship now", "full"], c: [2, "vibes", "full"] }, seen);
  const out = await rankWorth(jev, judged, { profile: "p", batch: 25, now: NOW, work: WORK });
  expect(out.ranked.map(r => [r.title, r.reason, r.verdict])).toEqual([["b", "ship now", "full"], ["a", "fun", "skim"]]);
  expect(seen).toEqual([{ tickets: WORK.tickets, pull_requests: WORK.pullRequests }]);
});

const ingested = (url: string, title: string, over: Partial<Ingested> = {}): Ingested => ({
  url,
  kind: "read",
  embed: { type: "article" },
  title,
  site: "x.dev",
  author: null,
  image: null,
  lengthSec: 600,
  worth: "unscored",
  tldr: [],
  chapters: [],
  content: null,
  ...over,
});

function setup(jev: Jev) {
  const db = openDb(":memory:");
  const titles: Record<string, Ingested> = {
    "https://a.dev": ingested("https://a.dev", "a"),
    "https://b.dev": ingested("https://b.dev", "b"),
    "https://talk.dev": ingested("https://talk.dev", "talk", { kind: "watch", embed: { type: "video" } }),
  };
  const store = createLaterStore({ db, ingest: async url => titles[url] ?? ingested(url, url) });
  const worth = createWorth({
    jev,
    saved: { read: createRankingStore(db, RANKING_ROWS.laterRead, WorthItemSchema), watch: createRankingStore(db, RANKING_ROWS.laterWatch, WorthItemSchema) },
    open: kind => store.open(kind),
    judged: v => store.judged(v),
    work: async () => WORK,
    profile: "p",
    batch: 25,
    shown: 8,
  });
  return { store, worth };
}

test("refresh ranks one kind, writes each verdict back to the item, and leaves finished items out", async () => {
  const { store, worth } = setup(fakeJev({ a: [2.9, "deep skill", "full"], b: [0.2, "stale", "archive"], talk: [2, "landscape", "skim"] }));
  const a = await store.save("https://a.dev");
  const b = await store.save("https://b.dev");
  const talk = await store.save("https://talk.dev");
  store.patch(b.id, { state: "done" });

  expect(await worth.rankers.read.refresh()).toMatchObject({ kind: "ready", items: [{ id: a.id, reason: "deep skill", verdict: "full" }], unranked: 0 });
  expect(store.get(a.id)?.worth).toBe("full");
  expect(store.get(b.id)?.worth).toBe("unscored");
  expect(store.get(talk.id)?.worth).toBe("unscored");
  expect(await worth.rankers.watch.snapshot()).toEqual({ kind: "unranked" });
});

test("a new save is scored on its own once, and an already judged item is left alone", async () => {
  let calls = 0;
  const jev = fakeJev({ a: [2, "career", "skim"] });
  const { store, worth } = setup(async (state, questions) => {
    calls++;
    return jev(state, questions);
  });
  const a = await store.save("https://a.dev");
  await worth.scoreSaved(a);
  expect(store.get(a.id)?.worth).toBe("skim");
  await worth.scoreSaved(await store.save("https://a.dev"));
  expect(calls).toBe(1);
});
