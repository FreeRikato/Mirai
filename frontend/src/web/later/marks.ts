import type { Span } from "./anchor";

type Piece = { node: Text; start: number };
export type TextIndex = { text: string; pieces: Piece[] };

export const MARK = "data-mark";

const TEXT_NODE = 3;
const isText = (n: Node): n is Text => n.nodeType === TEXT_NODE;

export function textIndex(root: Node): TextIndex {
  const doc = root.ownerDocument ?? document;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const pieces: Piece[] = [];
  let text = "";
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!isText(n)) continue;
    pieces.push({ node: n, start: text.length });
    text += n.data;
  }
  return { text, pieces };
}

export function spanOf(root: Node, range: Range): Span | null {
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const doc = root.ownerDocument ?? document;
  const before = doc.createRange();
  before.setStart(root, 0);
  before.setEnd(range.startContainer, range.startOffset);
  const start = before.toString().length;
  return { start, end: start + range.toString().length };
}

export function wrap(index: TextIndex, span: Span, make: () => HTMLElement): HTMLElement[] {
  const made: HTMLElement[] = [];
  for (const { node, start } of index.pieces) {
    const from = Math.max(span.start, start) - start;
    const to = Math.min(span.end, start + node.data.length) - start;
    if (from >= to || !node.parentNode) continue;
    if (to < node.data.length) node.splitText(to);
    const middle = from > 0 ? node.splitText(from) : node;
    const el = make();
    middle.replaceWith(el);
    el.append(middle);
    made.push(el);
  }
  return made;
}

export function unwrapAll(root: Element): void {
  const marks = [...root.querySelectorAll(`[${MARK}]`)];
  for (const m of marks) m.replaceWith(...m.childNodes);
  if (marks.length) root.normalize();
}
