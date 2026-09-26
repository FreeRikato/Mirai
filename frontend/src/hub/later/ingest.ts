import { z } from "zod";
import type { Chapter, Embed, LaterItem, LaterKind } from "@/shared/later";
import { isBareXArticle, type Media, type Social } from "@/shared/social";
import { classify } from "./classify";
import { pageMeta, parseChapters, readArticle, sentences, youtubeDetails } from "./extract";

export type Fetched = { status: number; contentType: string; body: string };
export type FetchText = (url: string) => Promise<Fetched | null>;
export type FetchSocial = (url: string) => Promise<Social>;

const NO_SOCIAL: FetchSocial = async () => ({ kind: "unavailable", reason: "social previews are off" });
const TITLE_CHARS = 90;

export type Ingested = Omit<LaterItem, "id" | "progress" | "position" | "state" | "savedAt" | "queueOrder" | "folder"> & { content: string | null };

const OEmbedSchema = z.object({
  title: z.string().optional(),
  author_name: z.string().optional(),
  thumbnail_url: z.string().optional(),
  duration: z.number().optional(),
});

async function oembed(fetchText: FetchText, endpoint: string): Promise<z.infer<typeof OEmbedSchema>> {
  const res = await fetchText(endpoint);
  if (!res || res.status !== 200) return {};
  try {
    return OEmbedSchema.parse(JSON.parse(res.body));
  } catch {
    return {};
  }
}

function fileTitle(url: string): string {
  const last = new URL(url).pathname.split("/").filter(Boolean).pop() ?? url;
  return decodeURIComponent(last).replace(/\.(pdf|mp4|webm|mov|m4v|html?)$/i, "").replace(/[-_]+/g, " ");
}

type Draft = { kind: LaterKind; embed: Embed; site: string; title: string | null; author: string | null; image: string | null; lengthSec: number | null; chapters: Chapter[]; text: string | null; content: string | null };

const picture = (media: readonly Media[]): string | null => {
  const first = media[0];
  return first ? (first.type === "image" ? first.url : first.poster) : null;
};

const clip = (text: string) => {
  const line = text.split("\n")[0]?.trim() ?? "";
  return line.length > TITLE_CHARS ? `${line.slice(0, TITLE_CHARS - 1).trimEnd()}…` : line;
};

const plainText = (html: string | null) => html?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || null;

async function draft(url: string, fetchText: FetchText, wpm: number, social: FetchSocial): Promise<Draft> {
  const c = classify(url);
  const base: Draft = { ...c, title: null, author: null, image: null, lengthSec: null, chapters: [], text: null, content: null };

  switch (c.embed.type) {
    case "social": {
      const s = await social(url);
      if (s.kind === "tweet") {
        const t = s.tweet;
        const a = t.article;
        if (a?.html) {
          const words = plainText(a.html)?.split(" ").length ?? 0;
          return { ...base, embed: { type: "article" }, site: "x.com", title: a.title, author: `@${t.author.handle}`, image: a.cover ?? t.author.avatar, lengthSec: Math.max(60, Math.round((words / wpm) * 60)), text: a.preview || null, content: a.html };
        }
        if (a) return { ...base, site: "x.com", title: a.title, author: `@${t.author.handle}`, image: a.cover ?? t.author.avatar, text: a.preview || null };
        return { ...base, site: "x.com", title: t.text ? `${t.author.name}: ${clip(t.text)}` : `${t.author.name} on X`, author: `@${t.author.handle}`, image: picture(t.media) ?? t.author.avatar, text: t.text || null };
      }
      if (s.kind === "reddit") {
        const r = s.thread;
        return { ...base, site: `r/${r.subreddit}`, title: r.title, author: `u/${r.author}`, image: picture(r.media), text: plainText(r.html) ?? r.title };
      }
      return isBareXArticle(url) ? { ...base, site: "x.com", title: "X article" } : base;
    }
    case "youtube": {
      const [info, page] = await Promise.all([oembed(fetchText, `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`), fetchText(`https://www.youtube.com/watch?v=${c.embed.videoId}`)]);
      const details = page ? youtubeDetails(page.body, c.embed.videoId) : null;
      return {
        ...base,
        title: info.title ?? null,
        author: info.author_name ?? null,
        image: info.thumbnail_url ?? `https://i.ytimg.com/vi/${c.embed.videoId}/hqdefault.jpg`,
        lengthSec: details?.lengthSec ?? null,
        chapters: details ? parseChapters(details.description) : [],
        text: details?.description ?? null,
      };
    }
    case "vimeo": {
      const info = await oembed(fetchText, `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`);
      return { ...base, title: info.title ?? null, author: info.author_name ?? null, image: info.thumbnail_url ?? null, lengthSec: info.duration ?? null };
    }
    case "video":
      return { ...base, title: fileTitle(url) };
    case "pdf": {
      const abs = new URL(url).hostname.endsWith("arxiv.org") ? await fetchText(url.replace("/pdf/", "/abs/").replace(/\.pdf$/, "")) : null;
      const m = abs?.status === 200 ? pageMeta(abs.body) : null;
      return { ...base, title: m?.title ?? fileTitle(url), author: m?.author ?? null, text: m?.description ?? null };
    }
    case "external":
    case "article": {
      const page = await fetchText(url);
      if (!page) return { ...base, embed: c.embed.type === "external" ? c.embed : { type: "external", reason: "couldn't reach the page" } };
      if (page.contentType.includes("application/pdf")) return { ...base, kind: "read", embed: { type: "pdf" }, title: fileTitle(url) };
      if (!page.contentType.includes("html")) return { ...base, embed: { type: "external", reason: `the page is ${page.contentType || "not html"}` } };
      const m = pageMeta(page.body);
      const shared = { ...base, kind: m.video ? ("watch" as const) : c.kind, title: m.title, author: m.author, image: m.image, site: m.site ?? c.site };
      if (c.embed.type === "external") return { ...shared, embed: c.embed, text: m.description };
      if (page.status >= 400) return { ...shared, embed: { type: "external", reason: `the site answered ${page.status}` }, text: m.description };
      const article = readArticle(page.body);
      if (!article) return { ...shared, embed: { type: "external", reason: "no readable article on this page" }, text: m.description };
      return { ...shared, lengthSec: Math.max(60, Math.round((article.words / wpm) * 60)), text: m.description ?? article.text, content: article.html };
    }
  }
}

export async function ingest(url: string, fetchText: FetchText, wpm: number, social: FetchSocial = NO_SOCIAL): Promise<Ingested> {
  const d = await draft(url, fetchText, wpm, social);
  return {
    url,
    kind: d.kind,
    embed: d.embed,
    title: d.title?.trim() || fileTitle(url) || url,
    site: d.site,
    author: d.author,
    image: d.image,
    lengthSec: d.lengthSec,
    worth: "unscored",
    tldr: d.text ? sentences(d.text, 3) : [],
    chapters: d.chapters,
    content: d.content,
  };
}

export function httpFetcher(timeoutMs: number): FetchText {
  return async url => {
    try {
      const res = await fetch(url, {
        redirect: "follow",
        signal: AbortSignal.timeout(timeoutMs),
        headers: { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131 Safari/537.36", "accept-language": "en" },
      });
      const contentType = res.headers.get("content-type") ?? "";
      const body = contentType.includes("pdf") ? "" : await res.text();
      return { status: res.status, contentType, body };
    } catch {
      return null;
    }
  };
}
