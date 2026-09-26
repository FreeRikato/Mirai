import { socialTarget, UNMATCHED_X_ARTICLE, xArticleId, type Social, type Tweet } from "@/shared/social";
import { createReddit } from "./reddit";
import { fetchTweet } from "./tweet";

const USER_AGENT = "mirai/0.1 (personal reader)";

export async function findXArticle(articleId: string, savedUrls: readonly string[], social: (url: string) => Promise<Social>): Promise<Tweet | null> {
  for (const url of savedUrls) {
    if (socialTarget(url)?.kind !== "tweet") continue;
    const s = await social(url);
    if (s.kind === "tweet" && s.tweet.article?.id === articleId) return s.tweet;
  }
  return null;
}

export function createSocial({ redditSession, timeoutMs, savedUrls }: { redditSession: string | undefined; timeoutMs: number; savedUrls: () => readonly string[] }) {
  const fetchJson = async (url: string): Promise<unknown> => {
    const res = await fetch(url, { headers: { "user-agent": USER_AGENT }, signal: AbortSignal.timeout(timeoutMs) }).catch(() => null);
    return res?.ok ? res.json().catch(() => null) : null;
  };
  const reddit = createReddit({
    session: redditSession,
    fetchReddit: url => fetch(url, { redirect: "manual", headers: { "user-agent": USER_AGENT, cookie: `reddit_session=${redditSession ?? ""}` }, signal: AbortSignal.timeout(timeoutMs) }),
  });

  const social = async (url: string): Promise<Social> => {
    const articleId = xArticleId(url);
    if (articleId) {
      const tweet = await findXArticle(articleId, savedUrls(), social);
      return tweet ? { kind: "tweet", tweet } : { kind: "unavailable", reason: UNMATCHED_X_ARTICLE };
    }
    const target = socialTarget(url);
    if (!target) return { kind: "unavailable", reason: "not a tweet or reddit thread" };
    try {
      if (target.kind === "reddit") return await reddit.thread(target.url);
      const tweet = await fetchTweet(target.id, fetchJson);
      return tweet ? { kind: "tweet", tweet } : { kind: "unavailable", reason: "X didn't return this tweet, it may be deleted or private" };
    } catch (err: unknown) {
      return { kind: "unavailable", reason: err instanceof Error ? err.message : String(err) };
    }
  };
  return social;
}

export type SocialFetch = ReturnType<typeof createSocial>;
