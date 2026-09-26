import { expect, test } from "bun:test";
import { pageMeta, parseChapters, readArticle, sentences, youtubeDetails } from "./extract";

const paragraph = "Row level security inlines each policy into the query plan before the planner runs. ".repeat(12);

test("page meta prefers open graph tags and falls back to the title element", () => {
  const html = `<html><head><title>Fallback</title><meta property="og:title" content="How RLS works"><meta property="og:site_name" content="pganalyze"><meta name="author" content="Lukas"><meta property="og:image" content="https://x/y.png"><meta property="og:type" content="video.other"></head><body></body></html>`;
  expect(pageMeta(html)).toEqual({ title: "How RLS works", site: "pganalyze", author: "Lukas", image: "https://x/y.png", description: null, video: true });
  expect(pageMeta("<html><head><title> Plain </title></head></html>").title).toBe("Plain");
});

test("readArticle extracts the main text and counts words, or gives up on thin pages", () => {
  const article = readArticle(`<html><body><nav>menu</nav><article><h1>RLS</h1><p>${paragraph}</p><p>${paragraph}</p></article></body></html>`);
  expect(article?.words).toBeGreaterThan(200);
  expect(article?.html).toContain("Row level security");
  expect(readArticle("<html><body><p>too short</p></body></html>")).toBeNull();
});

test("youtubeDetails reads length and description only for the requested video", () => {
  const html = `<script>var ytInitialPlayerResponse = {"videoDetails":{"videoId":"abcdefghijk","lengthSeconds":"1930","shortDescription":"0:00 intro\\n3:52 loop"}};var meta = 1;</script>`;
  expect(youtubeDetails(html, "abcdefghijk")).toEqual({ lengthSec: 1930, description: "0:00 intro\n3:52 loop" });
  expect(youtubeDetails(html, "zzzzzzzzzzz")).toBeNull();
  expect(youtubeDetails("<html></html>", "abcdefghijk")).toBeNull();
});

test("chapters need to start at 0:00 and keep increasing", () => {
  expect(parseChapters("Links below\n0:00 Why an SDK\n03:52 - The agent loop\n(1:02:10) Shipping")).toEqual([
    { at: 0, title: "Why an SDK" },
    { at: 232, title: "The agent loop" },
    { at: 3730, title: "Shipping" },
  ]);
  expect(parseChapters("1:00 not from zero\n2:00 second")).toEqual([]);
  expect(parseChapters("0:00 only one")).toEqual([]);
  expect(parseChapters("0:00 a\n5:00 b\n2:00 back in time")).toEqual([]);
});

test("sentences skips fragments and link lines", () => {
  expect(sentences("Short. This sentence is long enough to be kept around. See https://example.com for more details today. Another sentence that is also long enough!", 5)).toEqual([
    "This sentence is long enough to be kept around.",
    "Another sentence that is also long enough!",
  ]);
});
