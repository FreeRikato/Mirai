import { expect, test } from "bun:test";
import type { Social } from "@/shared/social";
import { ingest, type Fetched, type FetchText } from "./ingest";

const html = (body: string, head = ""): Fetched => ({ status: 200, contentType: "text/html; charset=utf-8", body: `<html><head>${head}</head><body>${body}</body></html>` });
const fake = (pages: Record<string, Fetched>): FetchText => async url => pages[url] ?? null;
const prose = "Policies are rewritten into the query as security barrier quals before planning happens. ".repeat(60);

test("an article gets its reader html, reading time and a mock tl;dr", async () => {
  const url = "https://pganalyze.com/blog/rls";
  const item = await ingest(url, fake({ [url]: html(`<article><h1>RLS</h1><p>${prose}</p></article>`, `<meta property="og:title" content="How RLS works"><meta property="og:site_name" content="pganalyze">`) }), 200);
  expect(item).toMatchObject({ kind: "read", embed: { type: "article" }, title: "How RLS works", site: "pganalyze" });
  expect(item.lengthSec).toBe(Math.round(((13 * 60) / 200) * 60));
  expect(item.content).toContain("security barrier");
  expect(item.tldr.length).toBeGreaterThan(0);
});

test("a page with no readable article and an unreachable page both fall back to opening externally", async () => {
  const thin = "https://app.example.com/dashboard";
  expect((await ingest(thin, fake({ [thin]: html("<div id=root></div>", "<title>App</title>") }), 200)).embed).toEqual({ type: "external", reason: "no readable article on this page" });
  const gone = await ingest("https://gone.example.com/post", fake({}), 200);
  expect(gone).toMatchObject({ embed: { type: "external", reason: "couldn't reach the page" }, title: "post" });
});

test("og:type video moves an article link into watch", async () => {
  const url = "https://www.loom.com/share/abc";
  const item = await ingest(url, fake({ [url]: html("<div></div>", `<meta property="og:type" content="video.other"><meta property="og:title" content="Demo">`) }), 200);
  expect(item).toMatchObject({ kind: "watch", title: "Demo", embed: { type: "external" } });
});

test("youtube uses oembed for the title and the watch page for length and chapters", async () => {
  const url = "https://youtu.be/abcdefghijk";
  const item = await ingest(
    url,
    fake({
      [`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`]: { status: 200, contentType: "application/json", body: JSON.stringify({ title: "Agents SDK", author_name: "Anthropic", thumbnail_url: "https://i.ytimg.com/t.jpg" }) },
      "https://www.youtube.com/watch?v=abcdefghijk": html(`<script>var ytInitialPlayerResponse = {"videoDetails":{"videoId":"abcdefghijk","lengthSeconds":"1930","shortDescription":"0:00 Intro\\n3:52 The loop"}};var x = 1;</script>`),
    }),
    200,
  );
  expect(item).toMatchObject({ kind: "watch", title: "Agents SDK", author: "Anthropic", lengthSec: 1930, chapters: [{ at: 0, title: "Intro" }, { at: 232, title: "The loop" }] });
});

test("a link that serves a pdf becomes a pdf read item", async () => {
  const url = "https://example.com/download?id=7";
  const item = await ingest(url, fake({ [url]: { status: 200, contentType: "application/pdf", body: "" } }), 200);
  expect(item).toMatchObject({ kind: "read", embed: { type: "pdf" } });
});

test("an arxiv pdf takes its title from the abstract page and keeps dotted ids intact otherwise", async () => {
  const url = "https://arxiv.org/pdf/1706.03762";
  const item = await ingest(url, fake({ "https://arxiv.org/abs/1706.03762": html("", `<meta property="og:title" content="Attention Is All You Need">`) }), 200);
  expect(item).toMatchObject({ kind: "read", embed: { type: "pdf" }, title: "Attention Is All You Need" });
  expect((await ingest("https://example.com/papers/1706.03762.pdf", fake({}), 200)).title).toBe("1706.03762");
});

test("tweets and reddit threads take their title, author and picture from the post itself, not the blocked page", async () => {
  const tweetUrl = "https://x.com/justsisyphus/status/1850000000000000000";
  const redditUrl = "https://www.reddit.com/r/rust/comments/abc/async_drop/";
  const social = async (url: string): Promise<Social> =>
    url === tweetUrl
      ? { kind: "tweet", tweet: { id: "1", url, author: { name: "Sisyphus Labs", handle: "justsisyphus", avatar: "https://pbs.twimg.com/a.jpg" }, text: "big news soon, stay tuned for our standalone desktop app", createdAt: "2026-09-20T00:00:00.000Z", media: [{ type: "video", url: "https://video.twimg.com/v.mp4", hls: null, poster: "https://pbs.twimg.com/poster.jpg", width: 1280, height: 720 }], quoted: null, article: null } }
      : { kind: "reddit", thread: { url, subreddit: "rust", title: "Async drop is here", author: "withoutboats", score: 1, comments: 0, createdAt: 0, html: "<p>Async drop finally landed in nightly after years of design work on the trait.</p>", link: null, media: [], replies: [], more: 0 } };
  const tweet = await ingest(tweetUrl, fake({}), 200, social);
  expect(tweet).toMatchObject({ kind: "read", embed: { type: "social" }, site: "x.com", author: "@justsisyphus", image: "https://pbs.twimg.com/poster.jpg", title: "Sisyphus Labs: big news soon, stay tuned for our standalone desktop app" });
  const thread = await ingest(redditUrl, fake({}), 200, social);
  expect(thread).toMatchObject({ kind: "read", embed: { type: "social" }, site: "r/rust", author: "u/withoutboats", title: "Async drop is here" });
});

test("a post carrying an X article is saved as the article itself, readable in the reader", async () => {
  const url = "https://x.com/DhravyaShah/status/2023630749065228364";
  const html = `<figure><img src="https://pbs.twimg.com/media/cover.jpg" alt=""></figure>${"<p>memory that forgets on purpose</p>".repeat(50)}`;
  const article = { id: "2019557885085446144", title: "Why OpenClaw's memory sucks", cover: "https://pbs.twimg.com/media/cover.jpg", preview: "TLDR: a new plugin", html };
  const post = { id: "2023630749065228364", url, author: { name: "Dhravya Shah", handle: "DhravyaShah", avatar: "https://pbs.twimg.com/a.jpg" }, text: "http://x.com/i/article/2019557885085446144", createdAt: "2026-02-17T05:29:02.000Z", media: [], quoted: null };
  const item = await ingest(url, fake({}), 200, async () => ({ kind: "tweet", tweet: { ...post, article } }));
  expect(item).toMatchObject({ kind: "read", embed: { type: "article" }, site: "x.com", title: "Why OpenClaw's memory sucks", author: "@DhravyaShah", image: "https://pbs.twimg.com/media/cover.jpg", lengthSec: 75, content: html });

  const previewOnly = await ingest(url, fake({}), 200, async () => ({ kind: "tweet", tweet: { ...post, article: { ...article, html: null } } }));
  expect(previewOnly).toMatchObject({ embed: { type: "social" }, title: "Why OpenClaw's memory sucks", image: "https://pbs.twimg.com/media/cover.jpg" });
});

test("a bare X article with no saved post carrying it is titled as an X article, not by its number", async () => {
  const item = await ingest("http://x.com/i/article/2019557885085446144", fake({}), 200, async () => ({ kind: "unavailable", reason: "none of your saved posts carries this one" }));
  expect(item).toMatchObject({ kind: "read", embed: { type: "social" }, site: "x.com", title: "X article" });
});
