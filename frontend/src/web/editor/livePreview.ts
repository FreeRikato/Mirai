import { syntaxTree } from "@codemirror/language";
import { StateEffect, type EditorState, type Range } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import type { SyntaxNodeRef } from "@lezer/common";
import { findWikiLinks } from "@/shared/wikilinks";
import { openLink } from "../peek/links";
import type { WikiRef, WikiSource } from "./wiki";

type Span = { from: number; to: number };

export const refreshPreview = StateEffect.define<null>();

const TASK = /^(\s*)([-*+]) \[(.)\] ?/;
const TASK_STATE: Record<string, string> = { " ": "open", "/": "doing", x: "done", X: "done", "-": "dropped", ">": "carried" };
const CLOSED = new Set(["done", "dropped", "carried"]);
const NEXT_MARK: Record<string, string> = { " ": "x", x: " ", X: " " };

const hide = Decoration.replace({});
const mark = (cls: string, attributes?: Record<string, string>) => Decoration.mark({ class: cls, attributes });
const line = (cls: string) => Decoration.line({ class: cls });

class BulletWidget extends WidgetType {
  override eq() {
    return true;
  }
  toDOM() {
    const dot = document.createElement("span");
    dot.className = "cm-md-bullet";
    dot.textContent = "•";
    return dot;
  }
}

class TaskWidget extends WidgetType {
  constructor(
    readonly state: string,
    readonly markAt: number,
  ) {
    super();
  }
  override eq(other: TaskWidget) {
    return other.state === this.state && other.markAt === this.markAt;
  }
  toDOM() {
    const box = document.createElement("span");
    box.className = `cm-md-task cm-md-task-${this.state}`;
    box.dataset.taskAt = String(this.markAt);
    box.setAttribute("role", "checkbox");
    box.setAttribute("aria-checked", String(this.state === "done"));
    box.setAttribute("aria-label", this.state);
    return box;
  }
  override ignoreEvent() {
    return false;
  }
}

class RuleWidget extends WidgetType {
  override eq() {
    return true;
  }
  toDOM() {
    const hr = document.createElement("span");
    hr.className = "cm-md-hr";
    return hr;
  }
}

const within = (spans: readonly Span[], from: number, to: number) => spans.some(s => from <= s.to && to >= s.from);

function linkPieces(node: SyntaxNodeRef, state: EditorState): { textFrom: number; textTo: number; url: string } | null {
  const marks: Span[] = [];
  let url = "";
  const cursor = node.node.cursor();
  if (!cursor.firstChild()) return null;
  do {
    if (cursor.name === "LinkMark") marks.push({ from: cursor.from, to: cursor.to });
    if (cursor.name === "URL") url = state.sliceDoc(cursor.from, cursor.to);
  } while (cursor.nextSibling());
  const [open, close] = marks;
  return open && close && url ? { textFrom: open.to, textTo: close.from, url } : null;
}

export function previewDecorations(state: EditorState, activeLines: ReadonlySet<number>, wiki: Pick<WikiSource, "exists"> | null, spans: readonly Span[] = [{ from: 0, to: state.doc.length }]): DecorationSet {
  const doc = state.doc;
  const out: Range<Decoration>[] = [];
  const active = (pos: number) => activeLines.has(doc.lineAt(pos).number);
  const taskLines = new Set<number>();
  const lineClass = (pos: number, cls: string) => out.push(line(cls).range(doc.lineAt(pos).from));
  const hideSpan = (from: number, to: number) => from < to && out.push(hide.range(from, to));

  for (const { from, to } of spans) {
    for (let pos = from; pos <= to; ) {
      const l = doc.lineAt(pos);
      const m = TASK.exec(l.text);
      const taskState = m ? TASK_STATE[m[3] ?? ""] : undefined;
      if (m && taskState) {
        taskLines.add(l.number);
        const start = l.from + (m[1] ?? "").length;
        if (!activeLines.has(l.number)) out.push(Decoration.replace({ widget: new TaskWidget(taskState, start + 3) }).range(start, l.from + m[0].length));
        if (CLOSED.has(taskState)) lineClass(l.from, "cm-md-task-closed");
      }
      pos = l.to + 1;
    }

    syntaxTree(state).iterate({
      from,
      to,
      enter: node => {
        const name = node.name;
        const heading = /^(?:ATX|Setext)Heading(\d)$/.exec(name);
        if (heading) lineClass(node.from, `cm-md-h${heading[1]}`);
        switch (name) {
          case "HeaderMark":
            if (!active(node.from)) hideSpan(node.from, state.sliceDoc(node.to, node.to + 1) === " " ? node.to + 1 : node.to);
            return;
          case "Emphasis":
            out.push(mark("cm-md-em").range(node.from, node.to));
            return;
          case "StrongEmphasis":
            out.push(mark("cm-md-strong").range(node.from, node.to));
            return;
          case "Strikethrough":
            out.push(mark("cm-md-strike").range(node.from, node.to));
            return;
          case "InlineCode":
            out.push(mark("cm-md-code").range(node.from, node.to));
            return;
          case "EmphasisMark":
          case "StrikethroughMark":
            if (!active(node.from)) hideSpan(node.from, node.to);
            return;
          case "CodeMark":
            if (node.node.parent?.name === "InlineCode") {
              if (!active(node.from)) hideSpan(node.from, node.to);
            } else out.push(mark("cm-md-fence-mark").range(node.from, node.to));
            return;
          case "FencedCode":
          case "CodeBlock":
            for (let pos = node.from; pos <= node.to; pos = doc.lineAt(pos).to + 1) lineClass(pos, "cm-md-codeblock");
            return;
          case "Blockquote":
            for (let pos = node.from; pos <= node.to; pos = doc.lineAt(pos).to + 1) lineClass(pos, "cm-md-quote");
            return;
          case "QuoteMark":
            if (!active(node.from)) hideSpan(node.from, state.sliceDoc(node.to, node.to + 1) === " " ? node.to + 1 : node.to);
            return;
          case "ListMark":
            if (!taskLines.has(doc.lineAt(node.from).number) && /^[-*+]$/.test(state.sliceDoc(node.from, node.to)) && !active(node.from)) {
              out.push(Decoration.replace({ widget: new BulletWidget() }).range(node.from, node.to));
            }
            return;
          case "HorizontalRule":
            if (!active(node.from)) out.push(Decoration.replace({ widget: new RuleWidget() }).range(node.from, node.to));
            return;
          case "Link": {
            const parts = linkPieces(node, state);
            if (!parts || active(node.from)) return;
            hideSpan(node.from, parts.textFrom);
            out.push(mark("cm-md-link", { "data-href": parts.url }).range(parts.textFrom, parts.textTo));
            hideSpan(parts.textTo, node.to);
            return false;
          }
          case "URL":
            if (node.node.parent?.name !== "Link") out.push(mark("cm-md-link", { "data-href": state.sliceDoc(node.from, node.to) }).range(node.from, node.to));
            return;
        }
      },
    });
  }

  for (const l of findWikiLinks(doc.toString())) {
    if (!within(spans, l.from, l.to)) continue;
    const cls = wiki === null || wiki.exists(l.target) ? "cm-md-wikilink" : "cm-md-wikilink cm-md-wikilink-missing";
    const open = l.from + (l.embed ? 3 : 2);
    const bar = state.sliceDoc(l.from, l.to).indexOf("|");
    const [labelFrom, labelTo] = bar === -1 ? [open, l.to - 2] : l.alias === null ? [open, l.from + bar] : [l.from + bar + 1, l.to - 2];
    const attrs = { "data-wiki": l.target };
    if (active(l.from)) {
      out.push(mark("cm-md-bracket").range(l.from, open), mark(cls, attrs).range(open, l.to - 2), mark("cm-md-bracket").range(l.to - 2, l.to));
    } else {
      hideSpan(l.from, labelFrom);
      if (labelFrom < labelTo) out.push(mark(cls, attrs).range(labelFrom, labelTo));
      hideSpan(labelTo, l.to);
    }
  }

  return Decoration.set(out, true);
}

function activeLinesOf(view: EditorView): Set<number> {
  const lines = new Set<number>();
  if (!view.hasFocus) return lines;
  const doc = view.state.doc;
  for (const r of view.state.selection.ranges) {
    for (let n = doc.lineAt(r.from).number; n <= doc.lineAt(r.to).number; n++) lines.add(n);
  }
  return lines;
}

export function livePreview(wiki: WikiRef) {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = previewDecorations(view.state, activeLinesOf(view), wiki.current, view.visibleRanges);
      }
      update(u: ViewUpdate) {
        const refreshed = u.transactions.some(t => t.effects.some(e => e.is(refreshPreview)));
        if (refreshed || u.docChanged || u.viewportChanged || u.selectionSet || u.focusChanged || syntaxTree(u.startState) !== syntaxTree(u.state)) {
          this.decorations = previewDecorations(u.state, activeLinesOf(u.view), wiki.current, u.view.visibleRanges);
        }
      }
    },
    { decorations: v => v.decorations },
  );

  const clicks = EditorView.domEventHandlers({
    mousedown(e, view) {
      if (!(e.target instanceof Element)) return false;
      const task = e.target.closest<HTMLElement>("[data-task-at]");
      if (task) {
        const at = Number(task.dataset.taskAt);
        const next = NEXT_MARK[view.state.sliceDoc(at, at + 1)] ?? "x";
        view.dispatch({ changes: { from: at, to: at + 1, insert: next } });
        return true;
      }
      const link = e.target.closest<HTMLElement>("[data-wiki],[data-href]");
      if (!link) return false;
      const rendered = !activeLinesOf(view).has(view.state.doc.lineAt(view.posAtDOM(link)).number);
      if (!rendered && !(e.metaKey || e.ctrlKey)) return false;
      e.preventDefault();
      const target = link.dataset.wiki;
      if (target !== undefined) wiki.current?.open(target);
      else if (link.dataset.href) openLink(link.dataset.href, e.metaKey || e.ctrlKey);
      return true;
    },
  });

  return [plugin, clicks];
}
