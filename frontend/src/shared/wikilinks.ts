export type WikiLink = {
  from: number;
  to: number;
  target: string;
  heading: string | null;
  alias: string | null;
  embed: boolean;
};

const LINK = /(!?)\[\[([^[\]\n]+?)\]\]/g;
const FENCE = /^\s*(```|~~~)/;
const INLINE_CODE = /`[^`\n]*`/g;
const EXTENSION = /\.([a-z0-9]{1,6})$/i;

const blank = (s: string) => " ".repeat(s.length);

function parseInner(inner: string): Pick<WikiLink, "target" | "heading" | "alias"> {
  const bar = inner.indexOf("|");
  const head = bar === -1 ? inner : inner.slice(0, bar).replace(/\\$/, "");
  const alias = bar === -1 ? null : inner.slice(bar + 1).trim() || null;
  const hash = head.indexOf("#");
  const target = (hash === -1 ? head : head.slice(0, hash)).trim();
  const heading = hash === -1 ? null : head.slice(hash + 1).trim() || null;
  return { target, heading, alias };
}

export function findWikiLinks(text: string): WikiLink[] {
  const links: WikiLink[] = [];
  let offset = 0;
  let fenced = false;
  for (const line of text.split("\n")) {
    if (FENCE.test(line)) fenced = !fenced;
    else if (!fenced) {
      for (const m of line.replace(INLINE_CODE, blank).matchAll(LINK)) {
        const from = offset + m.index;
        links.push({ from, to: from + m[0].length, embed: m[1] === "!", ...parseInner(m[2] ?? "") });
      }
    }
    offset += line.length + 1;
  }
  return links;
}

export const wikiLabel = (l: Pick<WikiLink, "target" | "heading" | "alias">): string => l.alias ?? (l.heading ? `${l.target} > ${l.heading}` : l.target);

export function isNoteTarget(target: string): boolean {
  if (!target) return false;
  const ext = EXTENSION.exec(target.split("/").pop() ?? "")?.[1];
  return ext === undefined || ext.toLowerCase() === "md";
}

const isNoteLink = (l: WikiLink) => !l.embed && isNoteTarget(l.target);

export function unwrapWikiLinks(text: string): string {
  let out = text;
  for (const l of findWikiLinks(text).filter(isNoteLink).toReversed()) out = out.slice(0, l.from) + wikiLabel(l) + out.slice(l.to);
  return out;
}

export function noteTargets(text: string): string[] {
  const seen = new Map<string, string>();
  for (const l of findWikiLinks(text).filter(isNoteLink)) {
    const key = normalize(l.target);
    if (!seen.has(key)) seen.set(key, l.target);
  }
  return [...seen.values()];
}

const normalize = (target: string) => target.trim().replace(/\.md$/i, "").toLowerCase();
const basename = (id: string) => id.slice(id.lastIndexOf("/") + 1);

export function createResolver(ids: readonly string[]): (target: string) => string | null {
  const byName = new Map<string, string[]>();
  for (const id of ids) {
    const key = normalize(basename(id));
    byName.set(key, [...(byName.get(key) ?? []), id]);
  }
  const shortest = (xs: readonly string[]) => xs.toSorted((a, b) => a.length - b.length || a.localeCompare(b))[0] ?? null;

  return target => {
    if (!isNoteTarget(target)) return null;
    const want = normalize(target);
    const candidates = byName.get(basename(want)) ?? [];
    if (!want.includes("/")) return shortest(candidates);
    return shortest(candidates.filter(id => normalize(id) === want || normalize(id).endsWith(`/${want}`)));
  };
}

const IMAGE = /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i;

export const isImageTarget = (target: string): boolean => IMAGE.test(target);

export function imageEmbeds(text: string): { text: string; images: string[] } {
  const embeds = findWikiLinks(text).filter(l => l.embed && isImageTarget(l.target));
  let rest = text;
  for (const l of embeds.toReversed()) rest = rest.slice(0, l.from) + rest.slice(l.to);
  return { text: rest.replace(/[ \t]{2,}/g, " ").trim(), images: embeds.map(l => l.target) };
}

export function createAssetResolver(paths: readonly string[]): (target: string) => string | null {
  const images = paths.filter(isImageTarget);
  const shortest = (xs: readonly string[]) => xs.toSorted((a, b) => a.length - b.length || a.localeCompare(b))[0] ?? null;
  return target => {
    if (!isImageTarget(target)) return null;
    const want = target.trim().toLowerCase();
    return shortest(images.filter(p => (want.includes("/") ? p.toLowerCase() === want || p.toLowerCase().endsWith(`/${want}`) : basename(p.toLowerCase()) === want)));
  };
}
