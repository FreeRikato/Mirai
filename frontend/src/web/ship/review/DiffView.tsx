import { cn } from "cn";
import { ExternalLink, X } from "lucide-react";
import { Fragment, useState, type ReactNode } from "react";
import type { TokenLine } from "@/shared/code";
import { anchorOf, sameAnchor, splitRows, type Anchor, type DiffLine, type Hunk, type Side } from "@/shared/diff";
import type { DraftComment, ReviewFile, ReviewThread } from "@/shared/ship";
import { ago } from "../../format";
import { Markdown } from "../../tasks/ui/Markdown";
import { GithubHtml } from "../GithubHtml";
import { segments } from "./decorate";
import { useDrafts, type DiffMode } from "./draft";

export type NoteContext = { prId: string; path: string; threads: readonly ReviewThread[]; pending: readonly DraftComment[]; composing: Anchor | null; compose: (a: Anchor | null) => void };

export type Colours = { old: readonly TokenLine[] | null; new: readonly TokenLine[] | null };

export const anchorKey = (a: Anchor) => `${a.side}:${a.line}`;

const lineTone: Record<DiffLine["kind"], string> = {
  add: "color-mix(in srgb, var(--color-ok) 12%, var(--color-bg))",
  del: "color-mix(in srgb, var(--color-bad) 12%, var(--color-bg))",
  context: "transparent",
};
const signTone: Record<DiffLine["kind"], string> = { add: "text-ok", del: "text-bad", context: "text-faint" };
const SIGN: Record<DiffLine["kind"], string> = { add: "+", del: "−", context: " " };

function tokensOf(colours: Colours, line: DiffLine): TokenLine | null {
  return line.kind === "del" ? (colours.old?.[line.old - 1] ?? null) : (colours.new?.[line.new - 1] ?? null);
}

export function DiffView({ file, mode, notes, colours, prUrl }: { file: ReviewFile; mode: DiffMode; notes: NoteContext; colours: Colours; prUrl: string }) {
  if (!file.hunks || file.hunks.length === 0) {
    return (
      <p className="m-0 flex items-center gap-2 px-5 py-6 text-dim">
        {file.status === "removed" ? "file deleted" : "no text diff (binary or too large to show)"}
        <a href={`${prUrl}/files`} target="_blank" rel="noreferrer" data-external className="flex items-center gap-1 text-link no-underline hover:underline">
          open on github <ExternalLink aria-hidden className="size-3" />
        </a>
      </p>
    );
  }
  return (
    <div role="table" aria-label={`diff of ${file.path}`} className="text-[10px] leading-[1.7]">
      {file.hunks.map(h => (
        <Fragment key={h.header}>
          <div className="border-y border-rule px-5 py-1 text-link" style={{ backgroundColor: "color-mix(in srgb, var(--color-link) 12%, var(--color-bg))" }}>{h.header}</div>
          {mode === "split" ? <SplitHunk hunk={h} notes={notes} colours={colours} /> : <UnifiedHunk hunk={h} notes={notes} colours={colours} />}
        </Fragment>
      ))}
    </div>
  );
}

function UnifiedHunk({ hunk, notes, colours }: { hunk: Hunk; notes: NoteContext; colours: Colours }) {
  return hunk.lines.map(line => {
    const a = anchorOf(line);
    return (
      <Fragment key={`${line.old}:${line.new}`}>
        <div role="row" className="group flex" style={{ backgroundColor: lineTone[line.kind] }}>
          <Num n={line.old} />
          <Num n={line.new} />
          <Code line={line} tokens={tokensOf(colours, line)} onComment={() => notes.compose(a)} />
        </div>
        <Notes anchor={a} notes={notes} />
      </Fragment>
    );
  });
}

function SplitHunk({ hunk, notes, colours }: { hunk: Hunk; notes: NoteContext; colours: Colours }) {
  return splitRows(hunk.lines).map(({ left, right }) => {
    const anchors = left && right && left === right ? [anchorOf(right)] : [left, right].flatMap(l => (l ? [anchorOf(l)] : []));
    return (
      <Fragment key={`${left?.old}:${right?.new}`}>
        <div role="row" className="flex">
          <Half line={left} side="old" colours={colours} onComment={a => notes.compose(a)} />
          <span aria-hidden className="w-px shrink-0 bg-rule" />
          <Half line={right} side="new" colours={colours} onComment={a => notes.compose(a)} />
        </div>
        {anchors.map(a => (
          <Notes key={anchorKey(a)} anchor={a} notes={notes} />
        ))}
      </Fragment>
    );
  });
}

function Half({ line, side, colours, onComment }: { line: DiffLine | null; side: "old" | "new"; colours: Colours; onComment: (a: Anchor) => void }) {
  if (!line) return <div className="flex-1" style={{ backgroundColor: "color-mix(in srgb, var(--color-fg) 4%, var(--color-bg))" }} />;
  return (
    <div className="group flex min-w-0 flex-1" style={{ backgroundColor: lineTone[line.kind] }}>
      <Num n={side === "old" ? line.old : line.new} />
      <Code line={line} tokens={tokensOf(colours, line)} onComment={() => onComment(anchorOf(line))} />
    </div>
  );
}

function Num({ n }: { n: number | null }) {
  return <span className="w-11 shrink-0 pr-2 text-right text-faint select-none">{n ?? ""}</span>;
}

function Code({ line, tokens, onComment }: { line: DiffLine; tokens: TokenLine | null; onComment: () => void }) {
  return (
    <button
      type="button"
      onClick={onComment}
      aria-label={line.kind === "del" ? `comment on old line ${line.old}` : `comment on line ${line.new}`}
      className="flex min-w-0 flex-1 cursor-pointer gap-2.5 border-0 bg-transparent px-2 text-left font-mono text-[10px] leading-[1.7] text-inherit hover:bg-white/[0.03]"
    >
      <span className={cn("shrink-0 select-none", signTone[line.kind])}>{SIGN[line.kind]}</span>
      <span className={cn("min-w-0 flex-1 break-words whitespace-pre-wrap", line.kind === "context" ? "text-soft" : "text-fg")}>
        {line.text
          ? segments(line.text, tokens).map(s => (
              <span key={s.start} style={s.color ? { color: s.color } : undefined}>
                {s.text}
              </span>
            ))
          : " "}
      </span>
    </button>
  );
}

function Notes({ anchor, notes }: { anchor: Anchor; notes: NoteContext }) {
  const here = (t: { side: Side; line: number | null }) => t.line !== null && sameAnchor({ side: t.side, line: t.line }, anchor);
  const threads = notes.threads.filter(t => t.path === notes.path && here(t));
  const pending = notes.pending.filter(c => c.path === notes.path && here(c));
  const composing = notes.composing !== null && sameAnchor(notes.composing, anchor);
  if (threads.length + pending.length === 0 && !composing) return null;
  return (
    <div data-anchor={`${notes.path}#${anchorKey(anchor)}`} className="flex flex-col gap-2.5 border-y border-rule bg-sunk py-2.5 pr-5 pl-[108px] text-[10px]">
      {threads.map(t => (
        <Thread key={t.id} thread={t} />
      ))}
      {pending.map(c => (
        <Pending key={`${c.side}:${c.line}:${c.body}`} prId={notes.prId} comment={c} />
      ))}
      {composing && <Composer prId={notes.prId} path={notes.path} anchor={anchor} onDone={() => notes.compose(null)} />}
    </div>
  );
}

function Comment({ author, meta, body, action }: { author: string; meta: ReactNode; body: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="flex items-center gap-2">
        <span className="text-fg">{author}</span>
        <span className="text-[9px]">{meta}</span>
        {action}
      </span>
      {body}
    </div>
  );
}

export function ThreadComments({ thread }: { thread: ReviewThread }) {
  return thread.comments.map((c, i) => <Comment key={`${c.createdAt}:${i}`} author={c.author} meta={<span className="text-dim">{ago(c.createdAt)}</span>} body={<GithubHtml html={c.html} />} />);
}

function Thread({ thread }: { thread: ReviewThread }) {
  const comments = <ThreadComments thread={thread} />;
  if (!thread.resolved) return <div className="flex flex-col gap-2.5 border-l-2 border-warn pl-2.5">{comments}</div>;
  return (
    <details className="border-l-2 border-rule pl-2.5">
      <summary className="cursor-pointer text-dim hover:text-fg">
        resolved · {thread.comments[0]?.author}: {thread.comments[0]?.body.split("\n")[0]}
      </summary>
      <div className="mt-2 flex flex-col gap-2.5">{comments}</div>
    </details>
  );
}

function Pending({ prId, comment }: { prId: string; comment: DraftComment }) {
  const remove = useDrafts(s => s.removeComment);
  return (
    <div className="border-l-2 border-warn pl-2.5">
      <Comment
        author="you"
        meta={<span className="text-warn">pending</span>}
        body={<Markdown className="text-[10px]">{comment.body}</Markdown>}
        action={
          <button type="button" aria-label="discard pending comment" onClick={() => remove(prId, comment)} className="ml-auto cursor-pointer border-0 bg-transparent p-0 text-dim hover:text-bad">
            <X aria-hidden className="size-3" />
          </button>
        }
      />
    </div>
  );
}

function Composer({ prId, path, anchor, onDone }: { prId: string; path: string; anchor: Anchor; onDone: () => void }) {
  const add = useDrafts(s => s.addComment);
  const [body, setBody] = useState("");
  const save = () => {
    if (!body.trim()) return;
    add(prId, { path, side: anchor.side, line: anchor.line, body: body.trim() });
    onDone();
  };
  return (
    <div className="flex flex-col gap-2">
      <span className="text-dim">
        comment on {path.split("/").at(-1)}:{anchor.line}
        {anchor.side === "LEFT" ? " (old)" : ""}
      </span>
      <textarea
        autoFocus
        aria-label="line comment"
        value={body}
        onChange={e => setBody(e.target.value)}
        onKeyDown={e => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            save();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onDone();
          }
        }}
        rows={3}
        className="min-h-14 resize-y border border-fg bg-bg p-2 font-mono text-[10px] text-fg outline-none"
      />
      <span className="flex items-center justify-end gap-3">
        <span className="text-[9px] text-dim">cmd enter · esc cancel</span>
        <button type="button" onClick={onDone} className="h-6 cursor-pointer border border-rule bg-transparent px-2.5 font-mono text-[10px] text-fg hover:border-fg">
          cancel
        </button>
        <button type="button" disabled={!body.trim()} onClick={save} className="h-6 cursor-pointer border-0 bg-fg px-2.5 font-mono text-[10px] text-bg disabled:cursor-default disabled:opacity-50">
          add to review
        </button>
      </span>
    </div>
  );
}
