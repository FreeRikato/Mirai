import { cn } from "cn";
import { ChevronDown, ChevronUp, Highlighter, Pencil, Search, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { create } from "zustand";
import { findQuote } from "@/shared/cite";
import type { Highlight, HighlightAnchor, LaterItem } from "@/shared/later";
import { ago } from "../format";
import { Modal } from "../Modal";
import { anchorAt, findAll, locate, type Span } from "./anchor";
import { useHighlightActions, useHighlights } from "./api";
import { useJump } from "./jump";
import { MARK, spanOf, textIndex, unwrapAll, wrap } from "./marks";

type Box = { left: number; top: number; bottom: number; width: number };
type Pending = { span: Span; box: Box };
type Dialog = { kind: "new"; anchor: HighlightAnchor } | { kind: "edit"; highlight: Highlight };
type Tip = { id: string; box: Box; pinned: boolean };

type Reading = {
  root: HTMLElement | null;
  frame: HTMLIFrameElement | null;
  pending: Pending | null;
  dialog: Dialog | null;
  findOpen: boolean;
  query: string;
  current: number;
  total: number;
  setSurface: (root: HTMLElement | null, frame: HTMLIFrameElement | null) => void;
  setPending: (p: Pending | null) => void;
  setDialog: (d: Dialog | null) => void;
  setFind: (open: boolean) => void;
  setQuery: (q: string) => void;
  step: (by: 1 | -1) => void;
  setTotal: (n: number) => void;
};

const useReading = create<Reading>()(set => ({
  root: null,
  frame: null,
  pending: null,
  dialog: null,
  findOpen: false,
  query: "",
  current: 0,
  total: 0,
  setSurface: (root, frame) => set({ root, frame, pending: null }),
  setPending: pending => set({ pending }),
  setDialog: dialog => set({ dialog }),
  setFind: findOpen => set(findOpen ? { findOpen } : { findOpen, query: "", current: 0, total: 0 }),
  setQuery: query => set({ query, current: 0 }),
  step: by => set(s => ({ current: s.total ? (s.current + by + s.total) % s.total : 0 })),
  setTotal: total => set(s => ({ total, current: Math.min(s.current, Math.max(0, total - 1)) })),
}));

const MIN_SELECTION = 3;
const NONE: readonly Highlight[] = [];

function typing(t: EventTarget | null): boolean {
  return isElement(t) && (t.closest("input, textarea, select, [contenteditable=true]") !== null);
}

const isElement = (t: EventTarget | null): t is Element => t !== null && "closest" in t && typeof t.closest === "function";

function screenBox(rect: DOMRect, frame: HTMLIFrameElement | null): Box {
  const offset = frame?.getBoundingClientRect();
  const left = rect.left + (offset?.left ?? 0);
  const top = rect.top + (offset?.top ?? 0);
  return { left, top, bottom: top + rect.height, width: rect.width };
}

function startHighlight() {
  const { root, pending, setDialog } = useReading.getState();
  if (!root || !pending) return;
  const { text } = textIndex(root);
  setDialog({ kind: "new", anchor: anchorAt(text, pending.span.start, pending.span.end) });
  root.ownerDocument.getSelection()?.removeAllRanges();
}

export function useSurface(root: HTMLElement | null, frame: HTMLIFrameElement | null) {
  const setSurface = useReading(s => s.setSurface);
  useEffect(() => {
    setSurface(root, frame);
    return () => setSurface(null, null);
  }, [root, frame, setSurface]);
}

export function ToolbarTools({ item }: { item: LaterItem }) {
  const { findOpen, setFind, pending } = useReading();
  const highlights = useHighlights(item.id).data ?? NONE;
  return (
    <span className="flex items-center gap-1.5">
      <ToolButton label="find in this page (⌘F)" pressed={findOpen} onClick={() => setFind(!findOpen)}>
        <Search aria-hidden className="size-3" />
        find
      </ToolButton>
      <ToolButton label="highlight the selected text (h)" disabled={!pending} onClick={startHighlight}>
        <Highlighter aria-hidden className="size-3" />
        highlight
      </ToolButton>
      {highlights.length > 0 && <span className="text-[10px] text-dim">{highlights.length === 1 ? "1 highlight" : `${highlights.length} highlights`}</span>}
    </span>
  );
}

function ToolButton({ label, pressed, disabled, onClick, children }: { label: string; pressed?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      onMouseDown={e => e.preventDefault()}
      onClick={onClick}
      className={cn(
        "flex h-[26px] cursor-pointer items-center gap-1.5 border bg-transparent px-2 font-mono text-[10px] disabled:cursor-default disabled:opacity-35",
        pressed ? "border-fg text-fg" : "border-rule text-soft hover:border-dim hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}

export function FindBar() {
  const { findOpen, query, current, total, setFind, setQuery, step } = useReading();
  if (!findOpen) return null;
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-rule px-4 py-1.5 font-mono text-[10px] md:px-5">
      <Search aria-hidden className="size-3 text-dim" />
      <input
        autoFocus
        aria-label="find in this page"
        value={query}
        onChange={e => setQuery(e.target.value)}
        onKeyDown={e => {
          if (e.key === "Enter") {
            e.preventDefault();
            step(e.shiftKey ? -1 : 1);
          } else if (e.key === "Escape") {
            e.preventDefault();
            setFind(false);
          }
        }}
        placeholder="find in this page"
        className="h-[26px] w-full max-w-[320px] border border-fg bg-bg px-2 font-mono text-[11px] text-fg outline-none placeholder:text-dim"
      />
      <span aria-live="polite" className="min-w-16 text-dim">
        {query.trim().length < 2 ? "" : total ? `${current + 1} / ${total}` : "no matches"}
      </span>
      <IconButton label="previous match" onClick={() => step(-1)}>
        <ChevronUp aria-hidden className="size-3" />
      </IconButton>
      <IconButton label="next match" onClick={() => step(1)}>
        <ChevronDown aria-hidden className="size-3" />
      </IconButton>
      <IconButton label="close find" onClick={() => setFind(false)}>
        <X aria-hidden className="size-3" />
      </IconButton>
    </div>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className="flex size-[26px] cursor-pointer items-center justify-center border border-rule bg-transparent text-soft hover:border-dim hover:text-fg">
      {children}
    </button>
  );
}

function useDecorations(highlights: readonly Highlight[], cite: string | null) {
  const { root, findOpen, query, current, setTotal } = useReading();
  const hits = useRef<HTMLElement[][]>([]);
  const citeMarks = useRef<HTMLElement[]>([]);
  const scrolledTo = useRef<string | null>(null);

  useEffect(() => {
    if (!root) return;
    const doc = root.ownerDocument;
    const mark = (kind: "hl" | "find" | "cite", attrs: Record<string, string>) => () => {
      const m = doc.createElement("mark");
      m.setAttribute(MARK, kind);
      for (const [k, v] of Object.entries(attrs)) m.setAttribute(k, v);
      return m;
    };
    let observer: MutationObserver | null = null;
    const apply = () => {
      unwrapAll(root);
      for (const h of highlights) {
        const index = textIndex(root);
        const span = locate(index.text, h);
        if (span) wrap(index, span, mark("hl", { "data-hl": h.id, ...(h.note ? { "data-note": "" } : {}) }));
      }
      const body = textIndex(root).text;
      const headerLength = root.querySelector(":scope > header")?.textContent?.length ?? 0;
      const quoted = cite ? findQuote(body.slice(headerLength), cite) : null;
      const citeSpan = quoted ? { start: quoted.start + headerLength, end: quoted.end + headerLength } : null;
      citeMarks.current = citeSpan ? wrap(textIndex(root), citeSpan, mark("cite", {})) : [];
      const found = findOpen ? findAll(textIndex(root).text, query) : [];
      hits.current = found.map(([start, end]) => wrap(textIndex(root), { start, end }, mark("find", {})));
      setTotal(hits.current.length);
      observer?.takeRecords();
    };
    apply();
    if (!cite) scrolledTo.current = null;
    const first = citeMarks.current[0];
    const win = doc.defaultView;
    if (cite && first && win && scrolledTo.current !== cite) {
      scrolledTo.current = cite;
      win.scrollTo({ top: first.getBoundingClientRect().top + win.scrollY - win.innerHeight / 3 });
    }
    let frame = 0;
    observer = new MutationObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(apply);
    });
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    return () => {
      observer?.disconnect();
      cancelAnimationFrame(frame);
      unwrapAll(root);
    };
  }, [root, highlights, cite, findOpen, query, setTotal]);

  useEffect(() => {
    if (!findOpen) return;
    hits.current.forEach((els, i) => els.forEach(el => el.toggleAttribute("data-current", i === current)));
    hits.current[current]?.[0]?.scrollIntoView({ block: "center" });
  }, [current, query, findOpen, highlights]);
}

function useSelectionWatch() {
  const { root, frame, setPending } = useReading();
  useEffect(() => {
    if (!root) return;
    const doc = root.ownerDocument;
    const onChange = () => {
      const sel = doc.getSelection();
      const range = sel && sel.rangeCount > 0 && !sel.isCollapsed ? sel.getRangeAt(0) : null;
      const span = range && range.toString().trim().length >= MIN_SELECTION ? spanOf(root, range) : null;
      setPending(range && span ? { span, box: screenBox(range.getBoundingClientRect(), frame) } : null);
    };
    doc.addEventListener("selectionchange", onChange);
    return () => doc.removeEventListener("selectionchange", onChange);
  }, [root, frame, setPending]);
}

function useKeys() {
  const { root, setFind } = useReading();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault();
        setFind(true);
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target) || e.key !== "h") return;
      if (!useReading.getState().pending) return;
      e.preventDefault();
      startHighlight();
    };
    const docs = [...new Set([document, root?.ownerDocument ?? document])];
    for (const d of docs) d.addEventListener("keydown", onKey);
    return () => {
      for (const d of docs) d.removeEventListener("keydown", onKey);
    };
  }, [root, setFind]);
}

export function ReadingLayer({ item }: { item: LaterItem }) {
  const highlights = useHighlights(item.id).data ?? NONE;
  const { root, frame, pending, dialog, setDialog } = useReading();
  const [tip, setTip] = useState<Tip | null>(null);
  const tipBox = useRef<HTMLDivElement>(null);
  const jump = useJump(s => s.jump);
  const cite = jump && jump.id === item.id && "quote" in jump ? jump.quote : null;
  useDecorations(highlights, cite);
  useEffect(() => {
    if (!root || !cite) return;
    const clear = (e: MouseEvent) => {
      if (isElement(e.target) && e.target.closest(`[${MARK}=cite]`)) return;
      useJump.getState().setJump(null);
    };
    root.ownerDocument.addEventListener("mousedown", clear);
    return () => root.ownerDocument.removeEventListener("mousedown", clear);
  }, [root, cite]);
  useSelectionWatch();
  useKeys();

  useEffect(() => {
    if (!root) return;
    const doc = root.ownerDocument;
    const markOf = (t: EventTarget | null) => (isElement(t) ? t.closest(`[data-hl]`) : null);
    const boxOf = (m: Element) => screenBox(m.getBoundingClientRect(), frame);
    const over = (e: MouseEvent) => {
      const m = markOf(e.target);
      if (m) setTip(t => (t?.pinned ? t : { id: m.getAttribute("data-hl") ?? "", box: boxOf(m), pinned: false }));
    };
    const out = (e: MouseEvent) => {
      if (markOf(e.target) && !markOf(e.relatedTarget)) setTip(t => (t?.pinned ? t : null));
    };
    const click = (e: MouseEvent) => {
      const m = markOf(e.target);
      if (!m || m.closest("a") || !doc.getSelection()?.isCollapsed) return;
      e.preventDefault();
      setTip({ id: m.getAttribute("data-hl") ?? "", box: boxOf(m), pinned: true });
    };
    const away = (e: MouseEvent) => {
      if (tipBox.current?.contains(e.target instanceof Node ? e.target : null) || markOf(e.target)) return;
      setTip(null);
    };
    root.addEventListener("mouseover", over);
    root.addEventListener("mouseout", out);
    root.addEventListener("click", click);
    const docs = [...new Set([document, doc])];
    for (const d of docs) d.addEventListener("mousedown", away);
    return () => {
      root.removeEventListener("mouseover", over);
      root.removeEventListener("mouseout", out);
      root.removeEventListener("click", click);
      for (const d of docs) d.removeEventListener("mousedown", away);
    };
  }, [root, frame]);

  const shown = tip ? highlights.find(h => h.id === tip.id) : undefined;

  return (
    <>
      {pending && !dialog && (
        <button
          type="button"
          onMouseDown={e => e.preventDefault()}
          onClick={startHighlight}
          style={{ left: pending.box.left + pending.box.width / 2, top: Math.max(8, pending.box.top - 36) }}
          className="fixed z-40 flex h-7 -translate-x-1/2 cursor-pointer items-center gap-1.5 border border-fg bg-bg px-2.5 font-mono text-[10px] text-fg"
        >
          <Highlighter aria-hidden className="size-3" />
          highlight
        </button>
      )}
      {tip && shown && (
        <div
          ref={tipBox}
          role={tip.pinned ? "dialog" : "tooltip"}
          aria-label="highlight note"
          style={{ left: Math.min(tip.box.left, window.innerWidth - 336), top: tip.box.bottom + 8 }}
          className="fixed z-40 flex w-[320px] flex-col gap-2 border border-faint bg-sunk px-3 py-2.5 text-[13px] leading-normal"
        >
          {shown.note ? <p className="m-0 font-key break-words whitespace-pre-wrap text-fg">{shown.note}</p> : <span className="font-mono text-[10px] text-dim">no note</span>}
          <span className="flex items-center gap-1.5 font-mono text-[9px] text-dim">
            {ago(shown.createdAt)}
            {tip.pinned && (
              <span className="ml-auto flex gap-1.5">
                <IconButton
                  label="edit note"
                  onClick={() => {
                    setTip(null);
                    setDialog({ kind: "edit", highlight: shown });
                  }}
                >
                  <Pencil aria-hidden className="size-3" />
                </IconButton>
                <DeleteButton itemId={item.id} id={shown.id} onDone={() => setTip(null)} />
              </span>
            )}
          </span>
        </div>
      )}
      {dialog && <NoteDialog itemId={item.id} dialog={dialog} onClose={() => setDialog(null)} />}
    </>
  );
}

function DeleteButton({ itemId, id, onDone }: { itemId: string; id: string; onDone: () => void }) {
  const { remove } = useHighlightActions(itemId);
  return (
    <IconButton
      label="delete highlight"
      onClick={() => {
        remove.mutate(id);
        onDone();
      }}
    >
      <Trash2 aria-hidden className="size-3" />
    </IconButton>
  );
}

function NoteDialog({ itemId, dialog, onClose }: { itemId: string; dialog: Dialog; onClose: () => void }) {
  const { add, note } = useHighlightActions(itemId);
  const [text, setText] = useState(dialog.kind === "edit" ? dialog.highlight.note : "");
  const quote = dialog.kind === "edit" ? dialog.highlight.quote : dialog.anchor.quote;
  const save = () => {
    if (dialog.kind === "new") add.mutate({ ...dialog.anchor, note: text });
    else note.mutate({ id: dialog.highlight.id, note: text });
    onClose();
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={dialog.kind === "new" ? "highlight" : "edit note"}
      description={<span className="line-clamp-4 border-l-2 border-warn pl-3 font-serif text-[14px] leading-snug text-fg">{quote}</span>}
      actions={
        <>
          <button type="button" onClick={onClose} className="h-8 cursor-pointer border border-rule bg-transparent px-3 font-mono text-[11px] text-fg hover:border-fg">
            cancel
          </button>
          <button type="button" onClick={save} className="h-8 cursor-pointer border-0 bg-fg px-3 font-mono text-[11px] text-bg">
            save
          </button>
        </>
      }
    >
      <textarea
        autoFocus
        aria-label="note"
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            save();
          }
        }}
        placeholder="note (optional)"
        rows={4}
        className="resize-y border border-rule bg-bg p-2 font-key text-[13px] text-fg outline-none placeholder:text-dim focus:border-fg"
      />
    </Modal>
  );
}
