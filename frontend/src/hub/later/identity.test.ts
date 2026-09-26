import { expect, test } from "bun:test";
import { identityOf, tweetAliases } from "./identity";

test("links to the same thing share one identity", () => {
  expect(identityOf("https://x.com/DhravyaShah/status/2023630749065228364?s=20")).toBe(identityOf("https://twitter.com/DhravyaShah/status/2023630749065228364"));
  expect(identityOf("http://x.com/i/article/2019557885085446144")).toBe("x-article:2019557885085446144");
  expect(identityOf("https://youtu.be/2qNX30hTyDg?si=abc")).toBe(identityOf("https://www.youtube.com/watch?v=2qNX30hTyDg&t=30"));
  expect(identityOf("https://www.reddit.com/r/rust/comments/abc/async_drop/?utm_source=share")).toBe(identityOf("https://old.reddit.com/r/rust/comments/abc/async_drop"));
  expect(identityOf("https://www.Example.com/post/?utm_source=x&id=7#top")).toBe(identityOf("https://example.com/post?id=7"));
});

test("different things keep different identities", () => {
  expect(identityOf("https://example.com/post?id=7")).not.toBe(identityOf("https://example.com/post?id=8"));
  expect(identityOf("https://x.com/a/status/1")).not.toBe(identityOf("https://x.com/a/status/2"));
});

test("a tweet is also known by the X article it carries", () => {
  expect(tweetAliases({ id: "20236", article: { id: "20195" } })).toEqual(["x:20236", "x-article:20195"]);
  expect(tweetAliases({ id: "20236", article: null })).toEqual(["x:20236"]);
});
