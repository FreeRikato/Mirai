import { expect, test } from "bun:test";
import { classify } from "./classify";

test("youtube links in every shape become an embeddable watch item", () => {
  for (const url of ["https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42", "https://youtu.be/dQw4w9WgXcQ", "https://m.youtube.com/shorts/dQw4w9WgXcQ", "https://youtube.com/live/dQw4w9WgXcQ"]) {
    expect(classify(url)).toEqual({ kind: "watch", site: "youtube.com", embed: { type: "youtube", videoId: "dQw4w9WgXcQ" } });
  }
});

test("a youtube page without a video id is an ordinary article", () => {
  expect(classify("https://www.youtube.com/@anthropic").embed).toEqual({ type: "article" });
});

test("vimeo, direct video files and pdfs get their own players", () => {
  expect(classify("https://vimeo.com/channels/staff/76979871").embed).toEqual({ type: "vimeo", videoId: "76979871" });
  expect(classify("https://cdn.example.com/talks/keynote.MP4")).toMatchObject({ kind: "watch", embed: { type: "video" } });
  expect(classify("https://arxiv.org/pdf/2401.00001")).toMatchObject({ kind: "read", embed: { type: "pdf" } });
  expect(classify("https://example.com/paper.pdf")).toMatchObject({ kind: "read", embed: { type: "pdf" } });
});

test("sites that refuse iframes open externally, sorted into read or watch", () => {
  expect(classify("https://www.instagram.com/reel/abc/")).toEqual({ kind: "watch", site: "instagram.com", embed: { type: "external", reason: "instagram doesn't allow embedding" } });
  expect(classify("https://x.com/justsisyphus")).toMatchObject({ kind: "read", embed: { type: "external", reason: "x.com doesn't allow embedding" } });
});

test("single tweets and reddit threads are shown in the app as social posts", () => {
  expect(classify("https://twitter.com/user/status/1")).toEqual({ kind: "read", site: "twitter.com", embed: { type: "social" } });
  expect(classify("https://www.reddit.com/r/rust/comments/abc/x/")).toEqual({ kind: "read", site: "reddit.com", embed: { type: "social" } });
});

test("X article links are social posts: by the author's link directly, or a bare link through a saved post that carries it", () => {
  expect(classify("https://x.com/DhravyaShah/article/2023630749065228364")).toEqual({ kind: "read", site: "x.com", embed: { type: "social" } });
  expect(classify("http://x.com/i/article/2019557885085446144")).toEqual({ kind: "read", site: "x.com", embed: { type: "social" } });
});

test("anything else is an article on its bare host", () => {
  expect(classify("https://www.pganalyze.com/blog/rls")).toEqual({ kind: "read", site: "pganalyze.com", embed: { type: "article" } });
});
