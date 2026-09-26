import { z } from "zod";
import type { XArticle } from "@/shared/social";

const Range = z.object({ offset: z.number().int().nonnegative(), length: z.number().int().nonnegative() });
const BlockSchema = z.object({
  type: z.string(),
  text: z.string(),
  inlineStyleRanges: z.array(Range.extend({ style: z.string() })).catch([]),
  entityRanges: z.array(Range.extend({ key: z.number().int() })).catch([]),
});
type Block = z.infer<typeof BlockSchema>;

const EntitySchema = z.object({ key: z.string(), value: z.object({ type: z.string(), data: z.record(z.string(), z.unknown()) }) });
type Entity = z.infer<typeof EntitySchema>["value"];

const ArticleSchema = z.object({
  id: z.string(),
  title: z.string(),
  preview_text: z.string().nullish(),
  cover_media: z.object({ media_info: z.object({ original_img_url: z.string() }) }).nullish(),
  content: z.object({ blocks: z.array(BlockSchema), entityMap: z.array(EntitySchema) }),
  media_entities: z.array(z.object({ media_id: z.string(), media_info: z.object({ original_img_url: z.string().optional() }) })).catch([]),
});

const LinkData = z.object({ url: z.string() });
const TweetData = z.object({ tweetId: z.string().regex(/^\d+$/) });
const MediaData = z.object({ mediaItems: z.array(z.object({ mediaId: z.string() })) });
const MarkdownData = z.object({ markdown: z.string() });

const ESCAPES: Readonly<Record<string, string>> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escape = (s: string) => s.replace(/[&<>"']/g, c => ESCAPES[c] ?? c);

function webUrl(raw: string | undefined): string | null {
  const u = raw === undefined ? null : URL.parse(raw);
  return u && (u.protocol === "https:" || u.protocol === "http:") ? u.href : null;
}

const figure = (src: string) => `<figure><img src="${escape(src)}" alt=""></figure>`;

const BLOCK_TAG: Readonly<Record<string, string>> = { unstyled: "p", "header-one": "h2", "header-two": "h2", "header-three": "h3", blockquote: "blockquote" };
const LIST_TAG: Readonly<Record<string, string>> = { "unordered-list-item": "ul", "ordered-list-item": "ol" };

function inline(b: Block, entities: ReadonlyMap<number, Entity>): string {
  const n = b.text.length;
  const bold: boolean[] = new Array<boolean>(n).fill(false);
  const italic: boolean[] = new Array<boolean>(n).fill(false);
  const href: (string | null)[] = new Array<string | null>(n).fill(null);
  const each = (r: z.infer<typeof Range>, mark: (i: number) => void) => {
    for (let i = r.offset; i < Math.min(n, r.offset + r.length); i++) mark(i);
  };
  for (const r of b.inlineStyleRanges) {
    if (r.style === "Bold") each(r, i => (bold[i] = true));
    if (r.style === "Italic") each(r, i => (italic[i] = true));
  }
  for (const r of b.entityRanges) {
    const e = entities.get(r.key);
    const url = e?.type === "LINK" ? webUrl(LinkData.safeParse(e.data).data?.url) : null;
    if (url) each(r, i => (href[i] = url));
  }

  let out = "";
  let start = 0;
  for (let i = 1; i <= n; i++) {
    if (i < n && bold[i] === bold[start] && italic[i] === italic[start] && href[i] === href[start]) continue;
    let run = escape(b.text.slice(start, i)).replace(/\n/g, "<br>");
    if (italic[start]) run = `<em>${run}</em>`;
    if (bold[start]) run = `<strong>${run}</strong>`;
    const link = href[start];
    if (link) run = `<a href="${escape(link)}">${run}</a>`;
    out += run;
    start = i;
  }
  return out;
}

function atomic(b: Block, entities: ReadonlyMap<number, Entity>, media: ReadonlyMap<string, string>): string {
  return b.entityRanges
    .map(r => {
      const e = entities.get(r.key);
      switch (e?.type) {
        case "MEDIA":
          return (MediaData.safeParse(e.data).data?.mediaItems ?? []).flatMap(m => media.get(m.mediaId) ?? []).map(figure).join("");
        case "TWEET": {
          const id = TweetData.safeParse(e.data).data?.tweetId;
          return id ? `<p><a href="https://x.com/i/status/${id}">embedded post on x</a></p>` : "";
        }
        case "MARKDOWN": {
          const md = MarkdownData.safeParse(e.data).data?.markdown;
          return md ? `<pre><code>${escape(md.replace(/^```[^\n]*\n?|\n?```\s*$/g, ""))}</code></pre>` : "";
        }
        case "DIVIDER":
          return "<hr>";
        default:
          return "";
      }
    })
    .join("");
}

export function parseXArticle(raw: unknown): XArticle | null {
  const parsed = ArticleSchema.safeParse(raw);
  if (!parsed.success) return null;
  const a = parsed.data;
  const entities = new Map(a.content.entityMap.map(e => [Number(e.key), e.value]));
  const media = new Map(a.media_entities.flatMap(m => (m.media_info.original_img_url ? [[m.media_id, m.media_info.original_img_url] as const] : [])));
  const cover = a.cover_media?.media_info.original_img_url ?? null;

  let html = cover ? figure(cover) : "";
  let list: string | null = null;
  for (const b of a.content.blocks) {
    const listTag = LIST_TAG[b.type] ?? null;
    if (list && list !== listTag) html += `</${list}>`;
    if (listTag && list !== listTag) html += `<${listTag}>`;
    list = listTag;
    if (listTag) html += `<li>${inline(b, entities)}</li>`;
    else if (b.type === "atomic") html += atomic(b, entities, media);
    else if (b.type === "code-block") html += `<pre><code>${escape(b.text)}</code></pre>`;
    else if (b.text.trim()) html += `<${BLOCK_TAG[b.type] ?? "p"}>${inline(b, entities)}</${BLOCK_TAG[b.type] ?? "p"}>`;
  }
  if (list) html += `</${list}>`;

  return { id: a.id, title: a.title, cover, preview: a.preview_text ?? "", html };
}
