import { expect, test } from "bun:test";
import { fetchTweet, syndicationToken } from "./tweet";

const syndication = {
  __typename: "Tweet",
  id_str: "1585341984679469056",
  created_at: "2022-10-26T18:45:58.000Z",
  text: "Entering HQ &amp; more 🚀 https://t.co/link https://t.co/pic",
  entities: { urls: [{ url: "https://t.co/link", expanded_url: "https://example.com/post", display_url: "example.com/post" }], media: [{ url: "https://t.co/pic" }] },
  user: { name: "Elon Musk", screen_name: "elonmusk", profile_image_url_https: "https://pbs.twimg.com/profile_images/1/a_normal.jpg" },
  mediaDetails: [
    { type: "photo", media_url_https: "https://pbs.twimg.com/media/p.jpg", ext_alt_text: "the lobby", original_info: { width: 1200, height: 800 } },
    {
      type: "video",
      media_url_https: "https://pbs.twimg.com/thumb.jpg",
      original_info: { width: 1920, height: 1080 },
      video_info: {
        variants: [
          { content_type: "application/x-mpegURL", url: "https://video.twimg.com/v.m3u8" },
          { content_type: "video/mp4", bitrate: 832000, url: "https://video.twimg.com/832.mp4" },
          { content_type: "video/mp4", bitrate: 2176000, url: "https://video.twimg.com/2176.mp4" },
          { content_type: "video/mp4", bitrate: 10368000, url: "https://video.twimg.com/10368.mp4" },
        ],
      },
    },
  ],
  quoted_tweet: {
    __typename: "Tweet",
    id_str: "20",
    created_at: "2006-03-21T20:50:14.000Z",
    text: "just setting up my twttr",
    user: { name: "jack", screen_name: "jack", profile_image_url_https: "https://pbs.twimg.com/profile_images/2/b_normal.jpg" },
  },
};

test("the embed token is derived from the tweet id the way X's own widget computes it", () => {
  expect(syndicationToken("20")).toBe(((20 / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, ""));
});

test("a tweet keeps its visible text with links expanded, photos, the best playable video and the quoted tweet", async () => {
  const asked: string[] = [];
  const tweet = await fetchTweet("1585341984679469056", async url => {
    asked.push(url);
    return url.startsWith("https://cdn.syndication.twimg.com/") ? syndication : null;
  });
  expect(asked[0]).toContain("tweet-result?id=1585341984679469056");
  expect(tweet).toMatchObject({
    id: "1585341984679469056",
    url: "https://x.com/elonmusk/status/1585341984679469056",
    author: { name: "Elon Musk", handle: "elonmusk", avatar: "https://pbs.twimg.com/profile_images/1/a_200x200.jpg" },
    text: "Entering HQ & more 🚀 https://example.com/post",
    quoted: { id: "20", text: "just setting up my twttr", author: { handle: "jack" } },
  });
  expect(tweet?.media).toEqual([
    { type: "image", url: "https://pbs.twimg.com/media/p.jpg?name=large", alt: "the lobby", width: 1200, height: 800 },
    { type: "video", url: "https://video.twimg.com/2176.mp4", hls: null, poster: "https://pbs.twimg.com/thumb.jpg", width: 1920, height: 1080 },
  ]);
});

test("when X's endpoint fails, FxTwitter fills in, and when both fail there is no tweet", async () => {
  const fx = {
    code: 200,
    tweet: {
      id: "20",
      url: "https://x.com/jack/status/20",
      text: "just setting up my twttr",
      created_at: "Tue Mar 21 20:50:14 +0000 2006",
      author: { name: "jack", screen_name: "jack", avatar_url: "https://pbs.twimg.com/a.jpg" },
      media: { photos: [{ url: "https://pbs.twimg.com/p.jpg", width: 10, height: 20, altText: "" }], videos: [{ url: "https://video.twimg.com/v.mp4", thumbnail_url: "https://pbs.twimg.com/t.jpg", width: 640, height: 360 }] },
    },
  };
  const tweet = await fetchTweet("20", async url => (url.startsWith("https://api.fxtwitter.com/") ? fx : null));
  expect(tweet).toMatchObject({ id: "20", createdAt: "2006-03-21T20:50:14.000Z", author: { handle: "jack" }, quoted: null });
  expect(tweet?.media.map(m => m.type)).toEqual(["image", "video"]);
  expect(await fetchTweet("20", async () => null)).toBeNull();
});

test("a tweet carrying an X article gets the full article from FxTwitter, or X's preview when FxTwitter is down", async () => {
  const preview = { rest_id: "2019557885085446144", title: "Why OpenClaw's memory sucks", preview_text: "TLDR: a new plugin", cover_media: { media_info: { original_img_url: "https://pbs.twimg.com/media/cover.jpg" } } };
  const withArticle = { ...syndication, quoted_tweet: undefined, mediaDetails: [], text: "https://t.co/a", entities: { urls: [{ url: "https://t.co/a", expanded_url: "http://x.com/i/article/2019557885085446144" }] }, article: preview };
  const full = {
    tweet: {
      article: {
        id: "2019557885085446144",
        title: "Why OpenClaw's memory sucks",
        preview_text: "TLDR: a new plugin",
        content: { blocks: [{ type: "unstyled", text: "Two-layer storage", inlineStyleRanges: [], entityRanges: [] }], entityMap: [] },
      },
    },
  };
  const asked: string[] = [];
  const tweet = await fetchTweet("1", async url => {
    asked.push(url);
    return url.startsWith("https://cdn.syndication.twimg.com/") ? withArticle : full;
  });
  expect(asked[1]).toBe("https://api.fxtwitter.com/status/1");
  expect(tweet?.article).toEqual({ id: "2019557885085446144", title: "Why OpenClaw's memory sucks", cover: null, preview: "TLDR: a new plugin", html: "<p>Two-layer storage</p>" });

  const down = await fetchTweet("1", async url => (url.startsWith("https://cdn.syndication.twimg.com/") ? withArticle : null));
  expect(down?.article).toEqual({ id: "2019557885085446144", title: "Why OpenClaw's memory sucks", cover: "https://pbs.twimg.com/media/cover.jpg", preview: "TLDR: a new plugin", html: null });
});

test("a plain tweet asks X once and has no article", async () => {
  const asked: string[] = [];
  const tweet = await fetchTweet("1585341984679469056", async url => {
    asked.push(url);
    return url.startsWith("https://cdn.syndication.twimg.com/") ? syndication : null;
  });
  expect(asked).toHaveLength(1);
  expect(tweet?.article).toBeNull();
});
