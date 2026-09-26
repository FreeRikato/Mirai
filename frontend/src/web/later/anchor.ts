import type { HighlightAnchor } from "@/shared/later";

export type Span = { start: number; end: number };

export const CONTEXT = 32;
const MIN_QUERY = 2;

export const anchorAt = (text: string, start: number, end: number, context = CONTEXT): HighlightAnchor => ({
  quote: text.slice(start, end),
  prefix: text.slice(Math.max(0, start - context), start),
  suffix: text.slice(end, end + context),
});

function sharedTail(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}

function sharedHead(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

export function locate(text: string, anchor: HighlightAnchor): Span | null {
  let best: { span: Span; score: number } | null = null;
  for (let at = text.indexOf(anchor.quote); at !== -1; at = text.indexOf(anchor.quote, at + 1)) {
    const end = at + anchor.quote.length;
    const score = sharedTail(text.slice(Math.max(0, at - anchor.prefix.length), at), anchor.prefix) + sharedHead(text.slice(end, end + anchor.suffix.length), anchor.suffix);
    if (!best || score > best.score) best = { span: { start: at, end }, score };
  }
  return best?.span ?? null;
}

export function findAll(text: string, query: string): [number, number][] {
  const q = query.trim().toLowerCase();
  if (q.length < MIN_QUERY) return [];
  const hay = text.toLowerCase();
  const out: [number, number][] = [];
  for (let at = hay.indexOf(q); at !== -1; at = hay.indexOf(q, at + q.length)) out.push([at, at + q.length]);
  return out;
}
