import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { z } from "zod";
import type { Chapter } from "@/shared/later";

export type PageMeta = { title: string | null; site: string | null; author: string | null; image: string | null; description: string | null; video: boolean };
export type Article = { html: string; text: string; words: number };

const MIN_ARTICLE_CHARS = 400;

function meta(doc: Document, ...names: string[]): string | null {
  for (const name of names) {
    const v = doc.querySelector(`meta[property="${name}"], meta[name="${name}"]`)?.getAttribute("content")?.trim();
    if (v) return v;
  }
  return null;
}

export function pageMeta(html: string): PageMeta {
  const { document } = parseHTML(html);
  return {
    title: meta(document, "og:title", "twitter:title") ?? (document.querySelector("title")?.textContent?.trim() || null),
    site: meta(document, "og:site_name"),
    author: meta(document, "author", "article:author", "twitter:creator"),
    image: meta(document, "og:image", "twitter:image"),
    description: meta(document, "og:description", "description", "twitter:description"),
    video: (meta(document, "og:type") ?? "").startsWith("video"),
  };
}

export function readArticle(html: string): Article | null {
  const { document } = parseHTML(html);
  const parsed = new Readability(document).parse();
  const text = parsed?.textContent?.replace(/\s+/g, " ").trim() ?? "";
  if (!parsed?.content || text.length < MIN_ARTICLE_CHARS) return null;
  return { html: parsed.content, text, words: text.split(" ").length };
}

const PlayerResponseSchema = z.object({
  videoDetails: z.object({ videoId: z.string(), lengthSeconds: z.coerce.number(), shortDescription: z.string().default("") }),
});

export function youtubeDetails(html: string, videoId: string): { lengthSec: number; description: string } | null {
  const json = html.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\});(?:var |<\/script>)/s)?.[1];
  if (!json) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  const parsed = PlayerResponseSchema.safeParse(raw);
  if (!parsed.success || parsed.data.videoDetails.videoId !== videoId) return null;
  return { lengthSec: parsed.data.videoDetails.lengthSeconds, description: parsed.data.videoDetails.shortDescription };
}

const STAMP = /^\s*[([]?((?:\d{1,2}:)?\d{1,2}:\d{2})[)\]]?\s*[-\u2013\u2014:|]?\s*(.+?)\s*$/;

const seconds = (stamp: string) => stamp.split(":").reduce((acc, part) => acc * 60 + Number(part), 0);

export function parseChapters(description: string): Chapter[] {
  const chapters = description.split("\n").flatMap(line => {
    const m = line.match(STAMP);
    return m?.[1] && m[2] ? [{ at: seconds(m[1]), title: m[2] }] : [];
  });
  const ordered = chapters.every((c, i) => i === 0 || c.at > (chapters[i - 1]?.at ?? 0));
  return chapters.length >= 2 && chapters[0]?.at === 0 && ordered ? chapters : [];
}

export function sentences(text: string, max: number): string[] {
  return (text.replace(/\s+/g, " ").match(/[^.!?]+[.!?]+/g) ?? [])
    .map(s => s.trim())
    .filter(s => s.length >= 30 && !/https?:\/\//.test(s))
    .slice(0, max);
}
