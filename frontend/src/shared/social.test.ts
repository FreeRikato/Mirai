import { expect, test } from "bun:test";
import { isProxiedMedia, mediaSrc, socialTarget, xArticleId } from "./social";

test("tweet links from x.com, twitter.com and their mirrors resolve to the tweet id", () => {
  expect(socialTarget("https://x.com/jack/status/20")).toEqual({ kind: "tweet", id: "20" });
  expect(socialTarget("https://twitter.com/jack/status/20?s=46&t=abc")).toEqual({ kind: "tweet", id: "20" });
  expect(socialTarget("https://mobile.twitter.com/i/web/status/1585341984679469056")).toEqual({ kind: "tweet", id: "1585341984679469056" });
  expect(socialTarget("https://fxtwitter.com/jack/status/20/photo/1")).toEqual({ kind: "tweet", id: "20" });
});

test("profiles and other x.com pages are not tweets", () => {
  expect(socialTarget("https://x.com/justsisyphus")).toBeNull();
  expect(socialTarget("https://x.com/home")).toBeNull();
});

test("reddit threads, share links and redd.it short links are reddit targets on www.reddit.com", () => {
  expect(socialTarget("https://old.reddit.com/r/programming/comments/1wk4lod/the_main_purpose/?sort=top")).toEqual({ kind: "reddit", url: "https://www.reddit.com/r/programming/comments/1wk4lod/the_main_purpose/" });
  expect(socialTarget("https://www.reddit.com/r/rust/s/AbC123xyz")).toEqual({ kind: "reddit", url: "https://www.reddit.com/r/rust/s/AbC123xyz" });
  expect(socialTarget("https://redd.it/1wk4lod")).toEqual({ kind: "reddit", url: "https://www.reddit.com/comments/1wk4lod/" });
  expect(socialTarget("https://www.reddit.com/r/rust/")).toBeNull();
  expect(socialTarget("https://example.com/r/x/comments/1")).toBeNull();
});

test("only X videos go through the hub, since video.twimg.com refuses requests that carry another site as referrer", () => {
  expect(mediaSrc("https://video.twimg.com/amplify_video/1/vid/avc1/720x720/a.mp4?tag=14")).toBe("/api/later/media?url=https%3A%2F%2Fvideo.twimg.com%2Famplify_video%2F1%2Fvid%2Favc1%2F720x720%2Fa.mp4%3Ftag%3D14");
  expect(mediaSrc("https://v.redd.it/x/CMAF_720.mp4")).toBe("https://v.redd.it/x/CMAF_720.mp4");
  expect(isProxiedMedia("https://video.twimg.com/a.mp4")).toBe(true);
  expect(isProxiedMedia("https://evil.example/a.mp4")).toBe(false);
  expect(isProxiedMedia("http://video.twimg.com/a.mp4")).toBe(false);
  expect(isProxiedMedia("not a url")).toBe(false);
});

test("only a bare x.com/i/article link is an X article id; an author's article link is the post itself", () => {
  expect(xArticleId("http://x.com/i/article/2019557885085446144")).toBe("2019557885085446144");
  expect(xArticleId("https://twitter.com/i/article/5/")).toBe("5");
  expect(xArticleId("https://x.com/DhravyaShah/article/2023630749065228364")).toBeNull();
  expect(socialTarget("https://x.com/DhravyaShah/article/2023630749065228364")).toEqual({ kind: "tweet", id: "2023630749065228364" });
  expect(xArticleId("https://example.com/i/article/5")).toBeNull();
});
