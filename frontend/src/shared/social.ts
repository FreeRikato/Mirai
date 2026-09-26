export type SocialTarget = { kind: "tweet"; id: string } | { kind: "reddit"; url: string };

export type Media =
  | { type: "image"; url: string; alt: string; width: number | null; height: number | null }
  | { type: "video"; url: string; hls: string | null; poster: string | null; width: number | null; height: number | null };

export type XArticle = { id: string; title: string; cover: string | null; preview: string; html: string | null };

export type Tweet = {
  id: string;
  url: string;
  author: { name: string; handle: string; avatar: string | null };
  text: string;
  createdAt: string;
  media: Media[];
  quoted: Tweet | null;
  article: XArticle | null;
};

export type RedditComment = { id: string; author: string; html: string; score: number; createdAt: number; replies: RedditComment[]; more: number };

export type RedditThread = {
  url: string;
  subreddit: string;
  title: string;
  author: string;
  score: number;
  comments: number;
  createdAt: number;
  html: string | null;
  link: string | null;
  media: Media[];
  replies: RedditComment[];
  more: number;
};

export type Social = { kind: "tweet"; tweet: Tweet } | { kind: "reddit"; thread: RedditThread } | { kind: "unavailable"; reason: string };

const TWITTER_HOSTS = new Set(["x.com", "twitter.com", "mobile.twitter.com", "fxtwitter.com", "vxtwitter.com", "fixupx.com"]);
const REDDIT_HOSTS = new Set(["reddit.com", "www.reddit.com", "old.reddit.com", "new.reddit.com", "np.reddit.com", "m.reddit.com"]);

export function socialTarget(raw: string): SocialTarget | null {
  const u = URL.parse(raw);
  if (!u) return null;
  const host = u.hostname.toLowerCase();
  const parts = u.pathname.split("/").filter(Boolean);
  if (TWITTER_HOSTS.has(host.replace(/^www\./, ""))) {
    const at = parts.findIndex((p, i) => p === "status" || (p === "article" && i === 1 && parts[0] !== "i"));
    const id = at === -1 ? undefined : parts[at + 1];
    return id && /^\d+$/.test(id) ? { kind: "tweet", id } : null;
  }
  if (host === "redd.it" && parts[0]) return { kind: "reddit", url: `https://www.reddit.com/comments/${parts[0]}/` };
  if (!REDDIT_HOSTS.has(host)) return null;
  const thread = parts.includes("comments") || (parts[0] === "r" && parts[2] === "s" && parts[3]);
  return thread ? { kind: "reddit", url: `https://www.reddit.com/${parts.join("/")}${parts.includes("comments") ? "/" : ""}` } : null;
}

export function xArticleId(raw: string): string | null {
  const u = URL.parse(raw);
  if (!u || !TWITTER_HOSTS.has(u.hostname.toLowerCase().replace(/^www\./, ""))) return null;
  return /^\/i\/article\/(\d+)\/?$/.exec(u.pathname)?.[1] ?? null;
}

export const isBareXArticle = (raw: string): boolean => xArticleId(raw) !== null;

export const UNMATCHED_X_ARTICLE = "X articles can only be read through the post that shared them, and none of your saved posts carries this one. Save that post's link instead";

const PROXIED_HOSTS = new Set(["video.twimg.com"]);

export function isProxiedMedia(raw: string): boolean {
  const u = URL.parse(raw);
  return u !== null && u.protocol === "https:" && PROXIED_HOSTS.has(u.hostname);
}

export const mediaSrc = (url: string): string => (isProxiedMedia(url) ? `/api/later/media?url=${encodeURIComponent(url)}` : url);
