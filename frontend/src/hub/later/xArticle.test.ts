import { expect, test } from "bun:test";
import { parseXArticle } from "./xArticle";

const block = (type: string, text: string, styles: { offset: number; length: number; style: string }[] = [], entities: { offset: number; length: number; key: number }[] = []) => ({
  type,
  text,
  inlineStyleRanges: styles,
  entityRanges: entities,
});

const fx = {
  id: "2019557885085446144",
  title: "Why everyone is complaining about OpenClaw's memory (it sucks) - and why supermemory fixes it.",
  preview_text: "TLDR: Today, we are releasing a new version of our openclaw plugin",
  cover_media: { media_info: { original_img_url: "https://pbs.twimg.com/media/HBVhQERWcAAEuZP.jpg" } },
  content: {
    blocks: [
      block("unstyled", "We launched our plugin a few weeks ago (it got 500k views!!)", [], [{ key: 0, offset: 23, length: 15 }]),
      block("atomic", " ", [], [{ key: 1, offset: 0, length: 1 }]),
      block("header-two", "OpenClaw's memory problems"),
      block("atomic", " ", [], [{ key: 2, offset: 0, length: 1 }]),
      block("unstyled", "It has a Two-layer storage:", [{ offset: 9, length: 18, style: "Bold" }]),
      block("ordered-list-item", "memory/YYYY-MM-DD.md — daily append-only logs.", [{ offset: 0, length: 20, style: "Bold" }]),
      block("ordered-list-item", "MEMORY.md — curated facts.\n\nOnly loaded in private sessions.", [{ offset: 0, length: 9, style: "Bold" }]),
      block("unordered-list-item", "memory_search — semantic search over <all> memory files", [{ offset: 16, length: 15, style: "Italic" }]),
      block("unordered-list-item", "memory_get — read specific lines"),
      block("unstyled", ""),
    ],
    entityMap: [
      { key: "0", value: { type: "LINK", data: { url: "https://x.com/DhravyaShah/status/2016308406701981731?s=20" } } },
      { key: "1", value: { type: "TWEET", data: { tweetId: "2023109374676496519" } } },
      { key: "2", value: { type: "MEDIA", data: { mediaItems: [{ mediaId: "2023618773438394372" }] } } },
    ],
  },
  media_entities: [{ media_id: "2023618773438394372", media_info: { original_img_url: "https://pbs.twimg.com/media/HBVWjYebcAQFdPl.jpg" } }],
};

test("an X article becomes readable html: styled text, links, headings, grouped lists, images and embedded posts", () => {
  const a = parseXArticle(fx);
  expect(a).toMatchObject({ id: "2019557885085446144", title: fx.title, cover: "https://pbs.twimg.com/media/HBVhQERWcAAEuZP.jpg", preview: fx.preview_text });
  const html = a?.html ?? "";
  expect(html).toContain('<p>We launched our plugin <a href="https://x.com/DhravyaShah/status/2016308406701981731?s=20">a few weeks ago</a> (it got 500k views!!)</p>');
  expect(html).toContain('<p><a href="https://x.com/i/status/2023109374676496519">embedded post on x</a></p>');
  expect(html).toContain("<h2>OpenClaw&#39;s memory problems</h2>");
  expect(html).toContain('<figure><img src="https://pbs.twimg.com/media/HBVWjYebcAQFdPl.jpg" alt=""></figure>');
  expect(html).toContain("<p>It has a <strong>Two-layer storage:</strong></p>");
  expect(html).toContain("<ol><li><strong>memory/YYYY-MM-DD.md</strong> — daily append-only logs.</li><li><strong>MEMORY.md</strong> — curated facts.<br><br>Only loaded in private sessions.</li></ol>");
  expect(html).toContain("<ul><li>memory_search — <em>semantic search</em> over &lt;all&gt; memory files</li><li>memory_get — read specific lines</li></ul>");
  expect(html).not.toContain("<p></p>");
  expect(html.startsWith('<figure><img src="https://pbs.twimg.com/media/HBVhQERWcAAEuZP.jpg" alt=""></figure>')).toBe(true);
});

test("links that are not http(s) keep their text but lose the link", () => {
  const html = parseXArticle({ ...fx, content: { blocks: [block("unstyled", "click me", [], [{ key: 0, offset: 0, length: 5 }])], entityMap: [{ key: "0", value: { type: "LINK", data: { url: "javascript:alert(1)" } } }] } })?.html;
  expect(html).toContain("<p>click me</p>");
});

test("anything that is not an article parses to nothing", () => {
  expect(parseXArticle(null)).toBeNull();
  expect(parseXArticle({ id: "1", title: "no content" })).toBeNull();
});
