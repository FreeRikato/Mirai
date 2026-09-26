import { socialTarget, xArticleId, type Tweet } from "@/shared/social";
import { classify } from "./classify";

const TRACKING = /^(utm_.+|ref|ref_src|fbclid|gclid|mc_cid|mc_eid)$/i;

function plainUrl(raw: string): string {
  const u = new URL(raw);
  u.hash = "";
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
  for (const key of [...u.searchParams.keys()]) if (TRACKING.test(key)) u.searchParams.delete(key);
  u.searchParams.sort();
  u.pathname = u.pathname.replace(/\/+$/, "") || "/";
  return `${u.hostname}${u.pathname}${u.search}`;
}

export function identityOf(url: string): string {
  const article = xArticleId(url);
  if (article) return `x-article:${article}`;
  const target = socialTarget(url);
  if (target?.kind === "tweet") return `x:${target.id}`;
  if (target?.kind === "reddit") return `reddit:${plainUrl(target.url)}`;
  const { embed } = classify(url);
  if (embed.type === "youtube" || embed.type === "vimeo") return `${embed.type}:${embed.videoId}`;
  return plainUrl(url);
}

export const tweetAliases = (tweet: Pick<Tweet, "id"> & { article: { id: string } | null }): string[] => [`x:${tweet.id}`, ...(tweet.article ? [`x-article:${tweet.article.id}`] : [])];
