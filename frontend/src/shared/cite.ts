export type CiteTarget = { kind: "moment"; at: number } | { kind: "passage"; quote: string } | { kind: "item" } | { kind: "malformed"; reason: string };
export type Cite = { id: string; target: CiteTarget };
export type Span = { start: number; end: number };

const ITEM_PATH = /^\/content\/item\/([^/?#]+)(\?[^#]*)?$/;
const SECONDS = /^\d+(\.\d+)?$/;

export const itemHref = (id: string): string => `/content/item/${encodeURIComponent(id)}`;

function targetOf(params: URLSearchParams): CiteTarget {
  const t = params.get("t");
  const q = params.get("q");
  if (t !== null) return SECONDS.test(t) ? { kind: "moment", at: Number(t) } : { kind: "malformed", reason: "malformed timestamp" };
  if (q !== null) return q.trim() ? { kind: "passage", quote: q.trim() } : { kind: "malformed", reason: "empty quote" };
  return { kind: "item" };
}

export function parseCiteHref(href: string): Cite | null {
  const m = ITEM_PATH.exec(href);
  if (!m?.[1]) return null;
  try {
    return { id: decodeURIComponent(m[1]), target: targetOf(new URLSearchParams(m[2] ?? "")) };
  } catch {
    return null;
  }
}

export function citeKey(cite: Cite): string {
  const t = cite.target;
  const detail = t.kind === "moment" ? String(t.at) : t.kind === "passage" ? t.quote : t.kind === "malformed" ? t.reason : "";
  return `${cite.id}\n${t.kind}\n${detail}`;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0" };
const MAX_CODE_POINT = 0x10ffff;

function decodeEntity(whole: string, body: string): string {
  const numeric = body.startsWith("#x") || body.startsWith("#X") ? Number.parseInt(body.slice(2), 16) : body.startsWith("#") ? Number.parseInt(body.slice(1), 10) : null;
  if (numeric === null) return ENTITIES[body.toLowerCase()] ?? whole;
  return Number.isInteger(numeric) && numeric >= 0 && numeric <= MAX_CODE_POINT ? String.fromCodePoint(numeric) : whole;
}

export const decodeEntities = (text: string): string => text.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, decodeEntity);

const BLOCK_TAG = /<\/?(p|div|li|ul|ol|td|th|tr|table|h[1-6]|br|hr|blockquote|pre|section|article|header|footer|figure|figcaption|dt|dd|dl)\b[^>]*>/gi;
const BLOCK_BREAK = "\u2063";

export const htmlText = (html: string): string =>
  decodeEntities(
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
      .replace(BLOCK_TAG, BLOCK_BREAK)
      .replace(/<[^>]+>/g, " "),
  );

const FOLD: Record<string, string> = { "\u2018": "'", "\u2019": "'", "\u201c": '"', "\u201d": '"', "\u2013": "-", "\u2014": "-" };
const IGNORED = /[\s\u00ad\u200b-\u200d\u2060\ufeff]/;

function normalized(text: string): { text: string; origin: number[] } {
  let out = "";
  const origin: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i] ?? "";
    if (IGNORED.test(c)) continue;
    const lowered = (FOLD[c] ?? c).toLowerCase();
    out += lowered;
    for (let k = 0; k < lowered.length; k++) origin.push(i);
  }
  return { text: out, origin };
}

export function findQuote(text: string, quote: string): Span | null {
  const needle = normalized(decodeEntities(quote)).text;
  if (needle === "") return null;
  const hay = normalized(text);
  const at = hay.text.indexOf(needle);
  if (at < 0) return null;
  const start = hay.origin[at];
  const last = hay.origin[at + needle.length - 1];
  return start === undefined || last === undefined ? null : { start, end: last + 1 };
}
