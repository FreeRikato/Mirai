import { expect, test } from "bun:test";
import { openDb } from "../db";
import type { Ingested } from "./ingest";
import { createLaterStore, stateAfterProgress } from "./store";

const ingested = (url: string, over: Partial<Ingested> = {}): Ingested => ({
  url,
  kind: "read",
  embed: { type: "article" },
  title: "How RLS works",
  site: "pganalyze.com",
  author: null,
  image: null,
  lengthSec: 840,
  worth: "unscored",
  tldr: ["Policies are inlined."],
  chapters: [],
  content: "<p>Policies are inlined into the plan.</p>",
  ...over,
});

function setup() {
  let clock = 1_000;
  const fetched: string[] = [];
  const store = createLaterStore({
    db: openDb(":memory:"),
    now: () => clock,
    ingest: async url => {
      fetched.push(url);
      return ingested(url);
    },
  });
  return { store, fetched, tick: (ms: number) => (clock += ms) };
}

test("saving stores the ingested item newest first and never fetches a known url twice", async () => {
  const { store, fetched, tick } = setup();
  const a = await store.save("https://a.dev/1");
  tick(10);
  await store.save("https://b.dev/2");
  expect(await store.save("https://a.dev/1")).toEqual(a);
  expect(fetched).toEqual(["https://a.dev/1", "https://b.dev/2"]);
  expect(store.list().map(i => i.url)).toEqual(["https://b.dev/2", "https://a.dev/1"]);
  expect(a).toMatchObject({ state: "unread", progress: 0, embed: { type: "article" }, tldr: ["Policies are inlined."] });
});

test("re-saving an archived link brings it back to the top as unread", async () => {
  const { store, tick } = setup();
  const a = await store.save("https://a.dev/1");
  tick(10);
  await store.save("https://b.dev/2");
  store.patch(a.id, { state: "archived" });
  tick(10);
  expect(await store.save("https://a.dev/1")).toMatchObject({ state: "unread" });
  expect(store.list()[0]?.id).toBe(a.id);
});

test("saving a link to something already saved, under another url or alias, returns that item without fetching", async () => {
  let clock = 1_000;
  const fetched: string[] = [];
  const store = createLaterStore({
    db: openDb(":memory:"),
    now: () => clock,
    ingest: async url => {
      fetched.push(url);
      return ingested(url);
    },
    aliases: async url => (url.includes("/i/article/") ? ["x:2023"] : []),
  });
  const tweet = await store.save("https://x.com/dhravya/status/2023?s=20");
  store.patch(tweet.id, { state: "done" });
  clock += 10;
  expect(await store.save("https://twitter.com/dhravya/status/2023")).toMatchObject({ id: tweet.id, state: "done" });
  expect(await store.save("http://x.com/i/article/2019")).toMatchObject({ id: tweet.id, state: "done" });
  expect(fetched).toEqual(["https://x.com/dhravya/status/2023?s=20"]);
  expect(store.list()).toHaveLength(1);
});

test("progress moves unread to in progress, and only an explicit mark makes it done", () => {
  expect(stateAfterProgress("unread", 0)).toBe("unread");
  expect(stateAfterProgress("unread", 0.2)).toBe("progress");
  expect(stateAfterProgress("progress", 1)).toBe("progress");
  expect(stateAfterProgress("done", 0.1)).toBe("done");
  expect(stateAfterProgress("archived", 1)).toBe("archived");
});

test("progress, patch and reader round trip through the database", async () => {
  const { store } = setup();
  const a = await store.save("https://a.dev/1");
  expect(store.progress(a.id, { progress: 0.4, position: 0.4 })).toMatchObject({ state: "progress", progress: 0.4 });
  expect(store.patch(a.id, { kind: "watch" })?.kind).toBe("watch");
  expect(store.get(a.id)).toMatchObject({ kind: "watch", state: "progress", position: 0.4 });
  expect(store.reader(a.id)).toEqual({ kind: "ready", html: "<p>Policies are inlined into the plan.</p>", words: 6 });
  expect(store.reader("missing")).toEqual({ kind: "unavailable", reason: "this item no longer exists" });
  expect(store.progress("missing", { progress: 1, position: 1 })).toBeNull();
});

test("a post saved as its X article keeps the reader, while threads stored before social posts still show as social", async () => {
  const { store } = setup();
  expect((await store.save("https://x.com/DhravyaShah/status/2023630749065228364")).embed).toEqual({ type: "article" });
  expect((await store.save("https://www.reddit.com/r/rust/comments/abc/x/")).embed).toEqual({ type: "social" });
});

test("a bare X article saved as blocked is looked up as a social post, and takes the article's title once found", async () => {
  const store = createLaterStore({ db: openDb(":memory:"), ingest: async url => ingested(url, { title: "X", embed: { type: "external", reason: "x.com doesn't allow embedding" } }) });
  const saved = await store.save("http://x.com/i/article/2019557885085446144");
  expect(saved.embed).toEqual({ type: "social" });
  expect(store.retitle(saved.id, { title: "Why OpenClaw's memory sucks", author: "@DhravyaShah", image: "https://pbs.twimg.com/media/cover.jpg", site: "x.com" })).toMatchObject({ title: "Why OpenClaw's memory sucks", author: "@DhravyaShah", site: "x.com", embed: { type: "social" } });
  expect(store.retitle("missing", { title: "t", author: null, image: null, site: "x.com" })).toBeNull();
});

test("a link saved into a folder goes to the end of it and never reaches the worth queue", async () => {
  const { store } = setup();
  const rls = store.createFolder("rls deep dive");
  const a = await store.save("https://a.dev/1", rls.id);
  const b = await store.save("https://b.dev/2", rls.id);
  await store.save("https://c.dev/3");
  expect([a.folder?.id, b.folder?.id]).toEqual([rls.id, rls.id]);
  expect(b.folder?.order ?? 0).toBeGreaterThan(a.folder?.order ?? 0);
  expect(store.open("read").map(j => j.item.url)).toEqual(["https://c.dev/3"]);
});

test("pasting a saved link inside a folder moves it there, and pasting it outside leaves it where it is", async () => {
  const { store, fetched } = setup();
  const rls = store.createFolder("rls deep dive");
  const agents = store.createFolder("agents");
  await store.save("https://a.dev/1");
  expect((await store.save("https://a.dev/1", rls.id)).folder?.id).toBe(rls.id);
  expect((await store.save("https://a.dev/1", agents.id)).folder?.id).toBe(agents.id);
  expect((await store.save("https://a.dev/1")).folder?.id).toBe(agents.id);
  expect(fetched).toEqual(["https://a.dev/1"]);
  expect(await store.save("https://a.dev/1", "no-such-folder").catch((e: unknown) => (e instanceof Error ? e.message : ""))).toBe("no such folder");
});

test("leaving a folder puts the item back in the queue unscored, keeping its place and saved date", async () => {
  const { store, tick } = setup();
  const rls = store.createFolder("rls deep dive");
  const a = await store.save("https://a.dev/1");
  store.patch(a.id, { state: "done" });
  store.judged(new Map([[a.id, "full"]]));
  store.move(a.id, rls.id);
  store.progress(a.id, { progress: 0.4, position: 1200 });
  tick(5_000);
  const back = store.move(a.id, null);
  expect(back).toMatchObject({ folder: null, state: "progress", worth: "unscored", progress: 0.4, position: 1200, savedAt: a.savedAt });
  const fresh = await store.save("https://b.dev/2");
  store.move(fresh.id, rls.id);
  expect(store.move(fresh.id, null)).toMatchObject({ state: "unread" });
});

test("deleting a folder hands its items back to the queue and renaming keeps them", async () => {
  const { store } = setup();
  const rls = store.createFolder("rls");
  const a = await store.save("https://a.dev/1", rls.id);
  expect(store.renameFolder(rls.id, "rls deep dive")?.name).toBe("rls deep dive");
  expect(store.get(a.id)?.folder?.id).toBe(rls.id);
  expect(store.deleteFolder(rls.id).map(i => [i.id, i.folder, i.state])).toEqual([[a.id, null, "unread"]]);
  expect(store.folders()).toEqual([]);
  expect(store.open("read").map(j => j.item.id)).toEqual([a.id]);
});

test("reordering a folder follows the ids given and ignores items from elsewhere", async () => {
  const { store } = setup();
  const rls = store.createFolder("rls");
  const a = await store.save("https://a.dev/1", rls.id);
  const b = await store.save("https://b.dev/2", rls.id);
  const c = await store.save("https://c.dev/3", rls.id);
  const loose = await store.save("https://d.dev/4");
  store.reorder(rls.id, [c.id, loose.id, a.id, b.id]);
  const order = store.list().filter(i => i.folder?.id === rls.id).sort((x, y) => (x.folder?.order ?? 0) - (y.folder?.order ?? 0)).map(i => i.id);
  expect(order).toEqual([c.id, a.id, b.id]);
  expect(store.get(loose.id)?.folder).toBeNull();
});

test("reordering the queue swaps places only among the ids given, so hidden items and folders keep theirs", async () => {
  const { store, tick } = setup();
  const rls = store.createFolder("rls");
  const [a, b, c, d] = await [1, 2, 3, 4].reduce<Promise<Awaited<ReturnType<typeof store.save>>[]>>(async (acc, n) => {
    const done = await acc;
    tick(10);
    return [...done, await store.save(`https://${n}.dev/`)];
  }, Promise.resolve([]));
  if (!a || !b || !c || !d) throw new Error("setup");
  const inFolder = await store.save("https://f.dev/", rls.id);
  const queue = () => store.list().filter(i => i.folder === null).map(i => i.id);
  expect(queue()).toEqual([d.id, c.id, b.id, a.id]);
  store.reorderQueue([a.id, inFolder.id, d.id, b.id]);
  expect(queue()).toEqual([a.id, c.id, d.id, b.id]);
  expect(store.open("read").map(j => j.item.id)).toEqual([a.id, c.id, d.id, b.id]);
  expect(store.get(inFolder.id)?.folder?.id).toBe(rls.id);
  tick(10);
  const e = await store.save("https://e.dev/");
  expect(queue()[0]).toBe(e.id);
});
