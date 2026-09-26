import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import { citeKey, findQuote, htmlText, parseCiteHref, type Cite } from "@/shared/cite";
import type { LaterItem, Segment } from "@/shared/later";
import type { CitationCheck } from "@/shared/mirai";

export type CitationSources = {
  item: (id: string) => { item: LaterItem; content: string | null } | null;
  segments: (videoId: string) => Segment[] | null;
};

type Verdict = Pick<CitationCheck, "status" | "reason">;

const NEAR_SEC = 2;
const QUOTE_WORDS = { min: 5, max: 15 };
const ok: Verdict = { status: "ok", reason: null };
const failed = (reason: string): Verdict => ({ status: "failed", reason });
const unchecked = (reason: string): Verdict => ({ status: "unchecked", reason });

type Node = { type: string; url?: string; children?: Node[] };

function linkUrls(markdown: string): string[] {
  const urls: string[] = [];
  const walk = (node: Node) => {
    if ((node.type === "link" || node.type === "definition") && node.url) urls.push(node.url);
    node.children?.forEach(walk);
  };
  walk(fromMarkdown(markdown, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] }));
  return urls;
}

function momentVerdict(at: number, item: LaterItem, src: CitationSources): Verdict {
  if (item.kind !== "watch") return failed("not a video");
  if (item.embed.type === "youtube") {
    const segments = src.segments(item.embed.videoId);
    if (!segments) return unchecked("transcript not ready");
    return segments.some(s => Math.abs(s.start - at) <= NEAR_SEC) ? ok : failed("not in transcript");
  }
  if (item.embed.type !== "video") return failed("this player cannot jump");
  if (item.lengthSec === null) return unchecked("video length unknown");
  return at <= item.lengthSec ? ok : failed("past the end of the video");
}

function passageVerdict(quote: string, content: string | null, text: () => string): Verdict {
  const words = quote.split(/\s+/).length;
  if (words < QUOTE_WORDS.min) return failed("quote too short");
  if (words > QUOTE_WORDS.max) return failed("quote too long");
  if (content === null) return failed("no article text");
  return findQuote(text(), quote) ? ok : failed("not in the article");
}

export function checkCitations(answer: string, src: CitationSources): CitationCheck[] {
  const texts = new Map<string, string>();
  const cites = new Map<string, Cite>();
  for (const url of linkUrls(answer)) {
    const cite = parseCiteHref(url);
    if (cite) cites.set(citeKey(cite), cite);
  }
  return [...cites].map(([key, cite]): CitationCheck => {
    const found = src.item(cite.id);
    const t = cite.target;
    const text = () => {
      const known = texts.get(cite.id);
      if (known !== undefined) return known;
      const fresh = htmlText(found?.content ?? "");
      texts.set(cite.id, fresh);
      return fresh;
    };
    const verdict: Verdict = !found ? failed("item removed") : t.kind === "malformed" ? failed(t.reason) : t.kind === "moment" ? momentVerdict(t.at, found.item, src) : t.kind === "passage" ? passageVerdict(t.quote, found.content, text) : ok;
    return { key, ...verdict };
  });
}
