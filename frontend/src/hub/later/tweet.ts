import { z } from "zod";
import type { Media, Tweet, XArticle } from "@/shared/social";
import { parseXArticle } from "./xArticle";

export type FetchJson = (url: string) => Promise<unknown>;

const MAX_BITRATE = 3_000_000;

const nullable = <T extends z.ZodType>(t: T) => t.nullish().transform(v => v ?? null);

const SyndicationUser = z.object({ name: z.string(), screen_name: z.string(), profile_image_url_https: nullable(z.string()) });
const Variant = z.object({ content_type: z.string(), url: z.string(), bitrate: nullable(z.number()) });
const MediaDetail = z.object({
  type: z.string(),
  media_url_https: z.string(),
  ext_alt_text: nullable(z.string()),
  original_info: nullable(z.object({ width: z.number(), height: z.number() })),
  video_info: nullable(z.object({ variants: z.array(Variant) })),
});
type SyndicationTweet = {
  id_str: string;
  created_at: string;
  text: string;
  user: z.infer<typeof SyndicationUser>;
  entities: { urls: { url: string; expanded_url: string }[] | null; media: { url: string }[] | null } | null;
  mediaDetails: z.infer<typeof MediaDetail>[] | null;
  quoted_tweet: SyndicationTweet | null;
  article?: unknown;
};
const SyndicationSchema: z.ZodType<SyndicationTweet> = z.lazy(() =>
  z.object({
    id_str: z.string(),
    created_at: z.string(),
    text: z.string(),
    user: SyndicationUser,
    entities: nullable(z.object({ urls: nullable(z.array(z.object({ url: z.string(), expanded_url: z.string() }))), media: nullable(z.array(z.object({ url: z.string() }))) })),
    mediaDetails: nullable(z.array(MediaDetail)),
    quoted_tweet: nullable(SyndicationSchema),
    article: z.unknown().optional(),
  }),
);

type FxTweet = {
  id: string;
  url: string;
  text: string;
  created_at: string;
  author: { name: string; screen_name: string; avatar_url: string | null };
  media: { photos: { url: string; width: number; height: number; altText: string | null }[] | null; videos: { url: string; thumbnail_url: string | null; width: number; height: number }[] | null } | null;
  quote: FxTweet | null;
  article?: unknown;
};
const FxTweetSchema: z.ZodType<FxTweet> = z.lazy(() =>
  z.object({
    id: z.string(),
    url: z.string(),
    text: z.string(),
    created_at: z.string(),
    author: z.object({ name: z.string(), screen_name: z.string(), avatar_url: nullable(z.string()) }),
    media: nullable(
      z.object({
        photos: nullable(z.array(z.object({ url: z.string(), width: z.number(), height: z.number(), altText: nullable(z.string()) }))),
        videos: nullable(z.array(z.object({ url: z.string(), thumbnail_url: nullable(z.string()), width: z.number(), height: z.number() }))),
      }),
    ),
    quote: nullable(FxTweetSchema),
    article: z.unknown().optional(),
  }),
);
const FxSchema = z.object({ tweet: FxTweetSchema });
const FxArticleSchema = z.object({ tweet: z.object({ article: z.unknown().optional() }) });

const ArticlePreviewSchema = z.object({
  rest_id: z.string(),
  title: z.string(),
  preview_text: nullable(z.string()),
  cover_media: nullable(z.object({ media_info: z.object({ original_img_url: z.string() }) })),
});

function articlePreview(raw: unknown): XArticle | null {
  const p = ArticlePreviewSchema.safeParse(raw);
  return p.success ? { id: p.data.rest_id, title: p.data.title, cover: p.data.cover_media?.media_info.original_img_url ?? null, preview: p.data.preview_text ?? "", html: null } : null;
}

export const syndicationToken = (id: string): string => ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, "");

const ENTITIES: Readonly<Record<string, string>> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" };
const decode = (s: string) => s.replace(/&(amp|lt|gt|quot|#39);/g, m => ENTITIES[m] ?? m);

function visibleText(t: SyndicationTweet): string {
  let text = t.text;
  for (const m of t.entities?.media ?? []) text = text.split(m.url).join("");
  for (const u of t.entities?.urls ?? []) text = text.split(u.url).join(u.expanded_url);
  return decode(text).trim();
}

function bestMp4(variants: readonly z.infer<typeof Variant>[]): string | null {
  const mp4 = variants.filter(v => v.content_type === "video/mp4").toSorted((a, b) => (a.bitrate ?? 0) - (b.bitrate ?? 0));
  return (mp4.filter(v => (v.bitrate ?? 0) <= MAX_BITRATE).at(-1) ?? mp4[0])?.url ?? null;
}

function syndicationMedia(d: z.infer<typeof MediaDetail>): Media | null {
  const size = { width: d.original_info?.width ?? null, height: d.original_info?.height ?? null };
  if (d.type === "photo") return { type: "image", url: `${d.media_url_https}?name=large`, alt: d.ext_alt_text ?? "", ...size };
  const url = bestMp4(d.video_info?.variants ?? []);
  return url ? { type: "video", url, hls: null, poster: d.media_url_https, ...size } : null;
}

const fromSyndication = (t: SyndicationTweet): Tweet => ({
  id: t.id_str,
  url: `https://x.com/${t.user.screen_name}/status/${t.id_str}`,
  author: { name: t.user.name, handle: t.user.screen_name, avatar: t.user.profile_image_url_https?.replace("_normal.", "_200x200.") ?? null },
  text: visibleText(t),
  createdAt: new Date(t.created_at).toISOString(),
  media: (t.mediaDetails ?? []).flatMap(d => syndicationMedia(d) ?? []),
  quoted: t.quoted_tweet ? fromSyndication(t.quoted_tweet) : null,
  article: articlePreview(t.article),
});

const fromFx = (t: FxTweet): Tweet => ({
  id: t.id,
  url: t.url,
  author: { name: t.author.name, handle: t.author.screen_name, avatar: t.author.avatar_url },
  text: t.text,
  createdAt: new Date(t.created_at).toISOString(),
  media: [
    ...(t.media?.photos ?? []).map((p): Media => ({ type: "image", url: p.url, alt: p.altText ?? "", width: p.width, height: p.height })),
    ...(t.media?.videos ?? []).map((v): Media => ({ type: "video", url: v.url, hls: null, poster: v.thumbnail_url, width: v.width, height: v.height })),
  ],
  quoted: t.quote ? fromFx(t.quote) : null,
  article: parseXArticle(t.article),
});

export async function fetchTweet(id: string, fetchJson: FetchJson): Promise<Tweet | null> {
  const primary = SyndicationSchema.safeParse(await fetchJson(`https://cdn.syndication.twimg.com/tweet-result?id=${id}&lang=en&token=${syndicationToken(id)}`));
  const fx = () => fetchJson(`https://api.fxtwitter.com/status/${id}`);
  if (primary.success) {
    const tweet = fromSyndication(primary.data);
    if (!tweet.article) return tweet;
    const full = FxArticleSchema.safeParse(await fx());
    return { ...tweet, article: (full.success ? parseXArticle(full.data.tweet.article) : null) ?? tweet.article };
  }
  const fallback = FxSchema.safeParse(await fx());
  return fallback.success ? fromFx(fallback.data.tweet) : null;
}
