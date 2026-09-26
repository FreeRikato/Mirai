import { expect, test } from "bun:test";
import { createReddit } from "./reddit";

const listing = (children: unknown[]) => ({ kind: "Listing", data: { children } });
const comment = (id: string, author: string, body: string, replies: unknown = "") => ({ kind: "t1", data: { id, author, body_html: `<div class="md"><p>${body}</p></div>`, score: 5, created_utc: 1790000000, replies } });
const post = (over: Record<string, unknown> = {}) => ({
  kind: "t3",
  data: { subreddit: "rust", title: "Async drop is here", author: "withoutboats", score: 812, num_comments: 3, created_utc: 1790000000, permalink: "/r/rust/comments/abc/async_drop/", is_self: true, selftext_html: '<div class="md"><p>Long post</p></div>', url: "https://www.reddit.com/r/rust/comments/abc/async_drop/", ...over },
});
const thread = (p: unknown, comments: unknown[]) => [listing([p]), listing(comments)];

function fake(answers: Record<string, Response>) {
  const asked: string[] = [];
  const fetchReddit = async (url: string) => {
    asked.push(url);
    return answers[url] ?? new Response("nope", { status: 404 });
  };
  return { asked, fetchReddit };
}

const json = (body: unknown) => Response.json(body);
const URL_JSON = "https://www.reddit.com/r/rust/comments/abc/async_drop.json?limit=500&depth=10&raw_json=1";

test("a thread brings the post and its whole nested comment tree, with collapsed branches counted", async () => {
  const replies = listing([comment("c2", "b", "reply"), { kind: "more", data: { count: 4, children: ["x"] } }]);
  const { fetchReddit, asked } = fake({ [URL_JSON]: json(thread(post(), [comment("c1", "a", "top", replies), { kind: "more", data: { count: 12, children: ["y"] } }])) });
  const out = await createReddit({ session: "s", fetchReddit }).thread("https://www.reddit.com/r/rust/comments/abc/async_drop/");
  expect(asked).toEqual([URL_JSON]);
  if (out.kind !== "reddit") throw new Error(out.kind === "unavailable" ? out.reason : "not reddit");
  expect(out.thread).toMatchObject({ subreddit: "rust", title: "Async drop is here", author: "withoutboats", score: 812, html: '<div class="md"><p>Long post</p></div>', link: null, more: 12 });
  expect(out.thread.replies.map(c => [c.author, c.replies.map(r => r.author), c.more])).toEqual([["a", ["b"], 4]]);
});

test("images, galleries and reddit video become media, and link posts keep their link", async () => {
  const gallery = post({ is_self: false, selftext_html: null, is_gallery: true, gallery_data: { items: [{ media_id: "m1" }, { media_id: "m2" }] }, media_metadata: { m1: { s: { u: "https://preview.redd.it/1.jpg?s=a", x: 800, y: 600 } }, m2: { s: { gif: "https://i.redd.it/2.gif", x: 400, y: 300 } } } });
  const video = post({ is_self: false, selftext_html: null, is_video: true, secure_media: { reddit_video: { hls_url: "https://v.redd.it/v/HLSPlaylist.m3u8", fallback_url: "https://v.redd.it/v/CMAF_720.mp4", width: 1280, height: 720 } }, preview: { images: [{ source: { url: "https://preview.redd.it/poster.jpg", width: 1280, height: 720 } }] } });
  const linkPost = post({ is_self: false, selftext_html: null, url: "https://blog.rust-lang.org/async-drop" });
  const reddit = (p: unknown) => createReddit({ session: "s", fetchReddit: async () => json(thread(p, [])) }).thread("https://www.reddit.com/r/rust/comments/abc/async_drop/");
  const [g, v, l] = await Promise.all([reddit(gallery), reddit(video), reddit(linkPost)]);
  expect(g.kind === "reddit" && g.thread.media).toEqual([
    { type: "image", url: "https://preview.redd.it/1.jpg?s=a", alt: "", width: 800, height: 600 },
    { type: "image", url: "https://i.redd.it/2.gif", alt: "", width: 400, height: 300 },
  ]);
  expect(v.kind === "reddit" && v.thread.media).toEqual([{ type: "video", url: "https://v.redd.it/v/CMAF_720.mp4", hls: "https://v.redd.it/v/HLSPlaylist.m3u8", poster: "https://preview.redd.it/poster.jpg", width: 1280, height: 720 }]);
  expect(l.kind === "reddit" && l.thread.link).toBe("https://blog.rust-lang.org/async-drop");
});

test("share links are followed to the thread they point at", async () => {
  const { fetchReddit, asked } = fake({
    "https://www.reddit.com/r/rust/s/AbC123": new Response(null, { status: 301, headers: { location: "https://www.reddit.com/r/rust/comments/abc/async_drop/?share_id=x" } }),
    [URL_JSON]: json(thread(post(), [])),
  });
  const out = await createReddit({ session: "s", fetchReddit }).thread("https://www.reddit.com/r/rust/s/AbC123");
  expect(out.kind).toBe("reddit");
  expect(asked).toEqual(["https://www.reddit.com/r/rust/s/AbC123", URL_JSON]);
});

test("without a session, with an expired one, or when reddit throttles, it says what to do", async () => {
  const url = "https://www.reddit.com/r/rust/comments/abc/async_drop/";
  expect(await createReddit({ session: undefined, fetchReddit: async () => json([]) }).thread(url)).toEqual({ kind: "unavailable", reason: "set MIRAI_REDDIT_SESSION on the hub to read reddit threads here" });
  expect(await createReddit({ session: "old", fetchReddit: async () => new Response("blocked", { status: 403 }) }).thread(url)).toEqual({
    kind: "unavailable",
    reason: "the reddit login expired: paste a fresh reddit_session cookie into MIRAI_REDDIT_SESSION on the hub",
  });
  expect(await createReddit({ session: "s", fetchReddit: async () => new Response("slow down", { status: 429 }) }).thread(url)).toEqual({ kind: "unavailable", reason: "reddit is rate limiting, try again in a minute" });
});
