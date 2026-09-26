import type { Parent, PhrasingContent, Root, RootContent, Text } from "mdast";
import { findWikiLinks, isImageTarget, isNoteTarget, wikiLabel, type WikiLink } from "@/shared/wikilinks";
import { vaultImageUrl } from "../../api";
import { notesHref } from "../../router";

const toNode = (l: WikiLink): PhrasingContent =>
  l.embed && isImageTarget(l.target) ? { type: "image", url: vaultImageUrl(l.target), alt: l.target } : { type: "link", url: notesHref(l.target), children: [{ type: "text", value: wikiLabel(l) }] };

function split(node: Text): PhrasingContent[] {
  const links = findWikiLinks(node.value).filter(l => isNoteTarget(l.target) || (l.embed && isImageTarget(l.target)));
  if (links.length === 0) return [node];
  const out: PhrasingContent[] = [];
  let at = 0;
  for (const l of links) {
    if (l.from > at) out.push({ type: "text", value: node.value.slice(at, l.from) });
    out.push(toNode(l));
    at = l.to;
  }
  if (at < node.value.length) out.push({ type: "text", value: node.value.slice(at) });
  return out;
}

function walk(node: Parent): void {
  const next: RootContent[] = [];
  for (const child of node.children) {
    if (child.type === "text") next.push(...split(child));
    else {
      if (child.type !== "link" && "children" in child) walk(child);
      next.push(child);
    }
  }
  node.children = next;
}

export const remarkWikiLinks = () => (tree: Root) => walk(tree);
