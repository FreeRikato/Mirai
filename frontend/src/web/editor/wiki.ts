import type { CompletionSource } from "@codemirror/autocomplete";
import { hoverTooltip, type Tooltip } from "@codemirror/view";
import { findWikiLinks } from "@/shared/wikilinks";

export type WikiSuggestion = { title: string; folder: string; insert: string };
export type WikiPeek = { title: string; folder: string; excerpt: string };

export type WikiSource = {
  exists: (target: string) => boolean;
  suggestions: () => readonly WikiSuggestion[];
  peek: (target: string) => WikiPeek | null;
  open: (target: string) => void;
};

export type WikiRef = { current: WikiSource | null };

const OPEN_LINK = /\[\[[^[\]|#\n]*$/;

export const wikiCompletion =
  (wiki: WikiRef): CompletionSource =>
  ctx => {
    const match = ctx.matchBefore(OPEN_LINK);
    if (!match || !wiki.current) return null;
    const closed = ctx.state.sliceDoc(ctx.pos, ctx.pos + 2) === "]]";
    return {
      from: match.from + 2,
      validFor: /^[^[\]|#\n]*$/,
      options: wiki.current.suggestions().map(s => ({ label: s.title, detail: s.folder || undefined, apply: closed ? s.insert : `${s.insert}]]`, type: "text" })),
    };
  };

function peekDom(target: string, peek: WikiPeek | null): HTMLElement {
  const dom = document.createElement("div");
  dom.className = "cm-wiki-peek";
  const head = dom.appendChild(document.createElement("div"));
  head.className = "cm-wiki-peek-head";
  head.appendChild(document.createElement("strong")).textContent = peek?.title ?? target;
  head.appendChild(document.createElement("span")).textContent = peek ? peek.folder || "vault" : "no note yet";
  if (peek?.excerpt) dom.appendChild(document.createElement("p")).textContent = peek.excerpt;
  dom.appendChild(document.createElement("span")).textContent = peek ? "click to open" : "click to create";
  return dom;
}

export const wikiHover = (wiki: WikiRef) =>
  hoverTooltip((view, pos): Tooltip | null => {
    const line = view.state.doc.lineAt(pos);
    const link = findWikiLinks(line.text).find(l => line.from + l.from <= pos && pos <= line.from + l.to);
    if (!link || !wiki.current) return null;
    const peek = wiki.current.peek(link.target);
    return { pos: line.from + link.from, end: line.from + link.to, above: false, create: () => ({ dom: peekDom(link.target, peek) }) };
  });
