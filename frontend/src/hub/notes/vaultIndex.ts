import { frontmatterOf, noteBody, noteFolder, noteTitle, type NoteHit, type NoteLink, type NoteMeta } from "@/shared/notes";
import { createResolver, findWikiLinks, wikiLabel } from "@/shared/wikilinks";

export type VaultFile = { id: string; text: string; mtime: number };

const FENCE = /^\s*(```|~~~)/;
const HEADING = /^\s*#{1,6}\s/;
const MD_LINK = /!?\[([^\]]*)\]\([^)]*\)/g;
const MARKUP = /[*_`~]+|^\s*(?:>\s*)+|^\s*(?:[-*+]|\d+\.)\s+(?:\[.\]\s*)?/gm;
const CONTEXT_MAX = 200;
const EXCERPT_MAX = 200;

const isDrawing = (text: string) => frontmatterOf(text).includes("excalidraw-plugin");

function plain(text: string): { prose: string; all: string } {
  const withLabels = findWikiLinks(text)
    .toReversed()
    .reduce((t, l) => t.slice(0, l.from) + wikiLabel(l) + t.slice(l.to), text);
  const prose: string[] = [];
  const all: string[] = [];
  let fenced = false;
  for (const line of withLabels.split("\n")) {
    if (FENCE.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced || !line.trim()) continue;
    const clean = line.replace(MD_LINK, "$1").replace(MARKUP, "").replace(/^#+\s*/, "").trim();
    all.push(clean);
    if (!HEADING.test(line)) prose.push(clean);
  }
  const join = (xs: string[]) => xs.join(" ").replace(/\s+/g, " ").trim();
  return { prose: join(prose), all: join(all) };
}

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

function linksOf(text: string, self: string, resolve: (target: string) => string | null): NoteLink[] {
  const out: NoteLink[] = [];
  for (const l of findWikiLinks(text)) {
    const to = resolve(l.target);
    if (!to || to === self || out.some(x => x.to === to)) continue;
    const end = text.indexOf("\n", l.to);
    const line = text.slice(text.lastIndexOf("\n", l.from) + 1, end === -1 ? undefined : end);
    out.push({ to, context: clip(line.trim(), CONTEXT_MAX) });
  }
  return out;
}

export function buildIndex(files: readonly VaultFile[]): NoteMeta[] {
  const resolve = createResolver(files.map(f => f.id));
  return files.map(f => {
    const drawing = isDrawing(f.text);
    const text = plain(noteBody(f.text));
    return {
      id: f.id,
      title: noteTitle(f.id),
      folder: noteFolder(f.id),
      mtime: f.mtime,
      words: drawing || !text.all ? 0 : text.all.split(" ").length,
      excerpt: drawing ? "" : clip(text.prose, EXCERPT_MAX),
      links: linksOf(f.text, f.id, resolve),
    };
  });
}

const SNIP_BEFORE = 40;
const SNIP_AFTER = 100;

function snip(text: string, at: number, len: number): string {
  const from = Math.max(0, at - SNIP_BEFORE);
  const to = Math.min(text.length, at + len + SNIP_AFTER);
  return `${from > 0 ? "…" : ""}${text.slice(from, to).trim()}${to < text.length ? "…" : ""}`;
}

export function searchNotes(files: readonly VaultFile[], query: string, limit: number): NoteHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const ranked: { hit: NoteHit; rank: number; mtime: number }[] = [];
  for (const f of files) {
    const title = noteTitle(f.id);
    const text = isDrawing(f.text) ? "" : plain(noteBody(f.text)).all;
    const inTitle = title.toLowerCase().indexOf(q);
    const inBody = text.toLowerCase().indexOf(q);
    if (inTitle === -1 && inBody === -1) continue;
    const snippet = inBody === -1 ? clip(text, SNIP_BEFORE + SNIP_AFTER) : snip(text, inBody, q.length);
    ranked.push({ hit: { id: f.id, title, snippet, inTitle: inTitle !== -1 }, rank: inTitle === 0 ? 0 : inTitle > 0 ? 1 : 2, mtime: f.mtime });
  }
  return ranked
    .toSorted((a, b) => a.rank - b.rank || b.mtime - a.mtime)
    .slice(0, limit)
    .map(r => r.hit);
}
