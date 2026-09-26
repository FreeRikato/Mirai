import { z } from "zod";
import type { Media, RedditComment, RedditThread, Social } from "@/shared/social";

export type FetchReddit = (url: string) => Promise<Response>;

const ORIGIN = "https://www.reddit.com";
const SHARE = /^\/r\/[^/]+\/s\/[^/]+\/?$/;

const nullable = <T extends z.ZodType>(t: T) => t.nullish().transform(v => v ?? null);

const Source = z.object({ url: z.string(), width: z.number(), height: z.number() });
const PostSchema = z.object({
  subreddit: z.string(),
  title: z.string(),
  author: z.string(),
  score: z.number(),
  num_comments: z.number(),
  created_utc: z.number(),
  permalink: z.string(),
  is_self: z.boolean(),
  selftext_html: nullable(z.string()),
  url: z.string(),
  is_video: nullable(z.boolean()),
  is_gallery: nullable(z.boolean()),
  post_hint: nullable(z.string()),
  secure_media: nullable(z.object({ reddit_video: nullable(z.object({ hls_url: z.string(), fallback_url: z.string(), width: nullable(z.number()), height: nullable(z.number()) })) })),
  preview: nullable(z.object({ images: z.array(z.object({ source: Source })) })),
  gallery_data: nullable(z.object({ items: z.array(z.object({ media_id: z.string() })) })),
  media_metadata: nullable(z.record(z.string(), z.object({ s: nullable(z.object({ u: nullable(z.string()), gif: nullable(z.string()), x: z.number(), y: z.number() })) }))),
});
type Post = z.infer<typeof PostSchema>;

type RawChild = { kind: "t1"; data: { id: string; author: string; body_html: string; score: number; created_utc: number; replies: RawListing | "" } } | { kind: "more"; data: { count: number } };
type RawListing = { data: { children: RawChild[] } };
const ListingSchema: z.ZodType<RawListing> = z.lazy(() => z.object({ data: z.object({ children: z.array(ChildSchema) }) }));
const ChildSchema: z.ZodType<RawChild> = z.lazy(() =>
  z.union([
    z.object({ kind: z.literal("t1"), data: z.object({ id: z.string(), author: z.string(), body_html: z.string(), score: z.number(), created_utc: z.number(), replies: z.union([ListingSchema, z.literal("")]) }) }),
    z.object({ kind: z.literal("more"), data: z.object({ count: z.number() }) }),
  ]),
);
const ThreadSchema = z.tuple([z.object({ data: z.object({ children: z.tuple([z.object({ data: PostSchema })]) }) }), ListingSchema]);

const IMAGE_URL = /\.(jpe?g|png|gif|webp)(\?|$)/i;

function mediaOf(p: Post): Media[] {
  const video = p.secure_media?.reddit_video;
  const poster = p.preview?.images[0]?.source ?? null;
  if (p.is_video && video) return [{ type: "video", url: video.fallback_url, hls: video.hls_url, poster: poster?.url ?? null, width: video.width, height: video.height }];
  if (p.is_gallery && p.gallery_data) {
    return p.gallery_data.items.flatMap(item => {
      const s = p.media_metadata?.[item.media_id]?.s;
      const url = s?.u ?? s?.gif;
      return s && url ? [{ type: "image" as const, url, alt: "", width: s.x, height: s.y }] : [];
    });
  }
  if (p.post_hint === "image" || IMAGE_URL.test(p.url)) return [{ type: "image", url: p.url, alt: "", width: poster?.width ?? null, height: poster?.height ?? null }];
  return [];
}

function comments(listing: RawListing | ""): { replies: RedditComment[]; more: number } {
  const children = listing === "" ? [] : listing.data.children;
  const replies = children.flatMap((c): RedditComment[] => {
    if (c.kind !== "t1") return [];
    const nested = comments(c.data.replies);
    return [{ id: c.data.id, author: c.data.author, html: c.data.body_html, score: c.data.score, createdAt: c.data.created_utc * 1000, replies: nested.replies, more: nested.more }];
  });
  const more = children.reduce((n, c) => (c.kind === "more" ? n + c.data.count : n), 0);
  return { replies, more };
}

function toThread(p: Post, listing: RawListing): RedditThread {
  const media = mediaOf(p);
  const tree = comments(listing);
  return {
    url: `${ORIGIN}${p.permalink}`,
    subreddit: p.subreddit,
    title: p.title,
    author: p.author,
    score: p.score,
    comments: p.num_comments,
    createdAt: p.created_utc * 1000,
    html: p.selftext_html,
    link: p.is_self || media.length > 0 || p.url.startsWith(ORIGIN) ? null : p.url,
    media,
    replies: tree.replies,
    more: tree.more,
  };
}

const unavailable = (reason: string): Social => ({ kind: "unavailable", reason });

const EXPIRED = "the reddit login expired: paste a fresh reddit_session cookie into MIRAI_REDDIT_SESSION on the hub";

function refused(res: Response): Social | null {
  if (res.status === 429) return unavailable("reddit is rate limiting, try again in a minute");
  if (res.status === 401 || res.status === 403 || (res.status >= 300 && res.status < 400)) return unavailable(EXPIRED);
  if (res.status === 404) return unavailable("reddit has no thread at this link");
  return res.ok ? null : unavailable(`reddit answered ${res.status}`);
}

export function createReddit({ session, fetchReddit }: { session: string | undefined; fetchReddit: FetchReddit }) {
  const resolve = async (url: string): Promise<string | Social> => {
    const u = new URL(url);
    if (!SHARE.test(u.pathname)) return u.pathname;
    const res = await fetchReddit(url);
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) return new URL(location, ORIGIN).pathname;
    return refused(res) ?? unavailable("couldn't follow the reddit share link");
  };

  return {
    async thread(url: string): Promise<Social> {
      if (!session) return unavailable("set MIRAI_REDDIT_SESSION on the hub to read reddit threads here");
      const path = await resolve(url);
      if (typeof path !== "string") return path;
      const res = await fetchReddit(`${ORIGIN}${path.replace(/\/$/, "")}.json?limit=500&depth=10&raw_json=1`);
      const bad = refused(res);
      if (bad) return bad;
      const parsed = ThreadSchema.safeParse(await res.json().catch(() => null));
      if (!parsed.success) return unavailable("reddit answered with something that isn't a thread");
      const [postListing, commentListing] = parsed.data;
      return { kind: "reddit", thread: toThread(postListing.data.children[0].data, commentListing) };
    },
  };
}

export type Reddit = ReturnType<typeof createReddit>;
