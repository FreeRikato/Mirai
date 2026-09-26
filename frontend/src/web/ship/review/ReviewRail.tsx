import { cn } from "cn";
import { ChevronDown, ChevronRight, Circle, CircleDot } from "lucide-react";
import { useState } from "react";
import { reviewProblem, VERDICTS, type ReviewThread, type ShipPr, type Verdict } from "@/shared/ship";
import { useSubmitReview } from "../api";
import { ShipCheck } from "../PrPreview";
import { ThreadComments } from "./DiffView";
import { useDraft, useDrafts } from "./draft";

const plain = (body: string) =>
  body
    .replace(/<[^>]*>/g, " ")
    .replace(/[*_`#>]+/g, "")
    .replace(/\s+/g, " ")
    .trim();

const VERDICT_LABEL: Record<Verdict, string> = { comment: "comment", approve: "approve", changes: "request changes" };
const VERDICT_TONE: Record<Verdict, string> = { comment: "text-fg", approve: "text-ok", changes: "text-bad" };

export function ReviewRail({ pr, headSha, threads, onJump }: { pr: ShipPr; headSha: string; threads: readonly ReviewThread[]; onJump: (t: ReviewThread) => void }) {
  const open = threads.filter(t => !t.resolved);
  const ordered = [...open, ...threads.filter(t => t.resolved)];
  const [expanded, setExpanded] = useState<string | null>(null);
  const pick = (t: ReviewThread) => {
    setExpanded(expanded === t.id ? null : t.id);
    onJump(t);
  };
  return (
    <aside aria-label="review" className="hidden w-[320px] shrink-0 flex-col border-l border-rule lg:flex">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <ShipCheck pr={pr} />
        <section className="flex flex-col gap-2.5 border-b border-rule px-5 py-3.5">
          <span className="flex items-center justify-between">
            <span className="text-[12px] font-semibold">threads</span>
            <span className="text-[10px] text-dim">
              {threads.length} · {open.length} open
            </span>
          </span>
          {ordered.length === 0 && <span className="text-[10px] text-dim">no comments yet</span>}
          {ordered.map(t => {
            const isOpen = expanded === t.id;
            const Chevron = isOpen ? ChevronDown : ChevronRight;
            const line = t.line ?? t.originalLine;
            return (
              <div key={t.id} className={cn("flex flex-col gap-2 border-l-2 pl-2.5", t.resolved ? "border-rule" : "border-warn")}>
                <button type="button" aria-expanded={isOpen} onClick={() => pick(t)} className="flex cursor-pointer flex-col gap-0.5 border-0 bg-transparent p-0 text-left font-mono text-[10px]">
                  <span className="flex w-full items-center gap-1.5">
                    <Chevron aria-hidden className="size-3 shrink-0 text-dim" />
                    <span className={cn("min-w-0 flex-1 truncate", t.resolved ? "text-dim" : "text-fg")} title={t.path}>
                      {t.path.split("/").at(-1)}
                      {line !== null && `:${line}`}
                    </span>
                    <span className={cn("shrink-0 text-[9px]", t.resolved || t.outdated ? "text-dim" : "text-warn")}>{t.outdated ? "outdated" : t.resolved ? "resolved" : "open"}</span>
                  </span>
                  {!isOpen && (
                    <span className={cn("line-clamp-2 pl-[18px]", t.resolved ? "text-dim" : "text-soft")}>
                      {t.comments[0]?.author}: {plain(t.comments[0]?.body ?? "")}
                    </span>
                  )}
                </button>
                {isOpen && (
                  <div className="flex flex-col gap-2.5 pl-[18px] text-[10px]">
                    {t.outdated && <span className="text-[9px] text-dim">the code this was on has changed since{t.originalLine !== null && `, it was line ${t.originalLine}`}</span>}
                    <ThreadComments thread={t} />
                  </div>
                )}
              </div>
            );
          })}
        </section>
      </div>
      <Submit pr={pr} headSha={headSha} />
    </aside>
  );
}

function Submit({ pr, headSha }: { pr: ShipPr; headSha: string }) {
  const draft = useDraft(pr.id);
  const { setBody, setVerdict, clear } = useDrafts();
  const submit = useSubmitReview();
  const own = pr.relation === "author";
  const problem = reviewProblem(draft, own);
  const send = () =>
    submit.mutate({ id: pr.id, headSha, verdict: draft.verdict, body: draft.body, comments: draft.comments }, { onSuccess: () => clear(pr.id) });

  return (
    <section className="flex flex-col gap-2.5 border-t border-rule px-5 py-3.5">
      <span className="flex items-center justify-between">
        <span className="text-[12px] font-semibold">your review</span>
        <span className={cn("text-[10px]", draft.comments.length ? "text-warn" : "text-dim")}>{draft.comments.length} pending</span>
      </span>
      <textarea
        aria-label="review summary"
        value={draft.body}
        onChange={e => setBody(pr.id, e.target.value)}
        placeholder="summary (optional)"
        rows={3}
        className="resize-y border border-rule bg-bg p-2 font-mono text-[10px] text-fg outline-none placeholder:text-dim focus:border-fg"
      />
      <div role="radiogroup" aria-label="verdict" className="flex flex-col gap-1.5">
        {VERDICTS.map(v => {
          const on = draft.verdict === v;
          const Icon = on ? CircleDot : Circle;
          const blocked = own && v !== "comment";
          return (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={blocked}
              onClick={() => setVerdict(pr.id, v)}
              className={cn("flex cursor-pointer items-center gap-2 border-0 bg-transparent p-0 font-mono text-[10px] disabled:cursor-default disabled:opacity-35", on ? VERDICT_TONE[v] : "text-dim hover:text-fg")}
            >
              <Icon aria-hidden className="size-3" />
              {VERDICT_LABEL[v]}
            </button>
          );
        })}
      </div>
      {submit.error ? <span className="text-[10px] break-words text-bad">{submit.error.message}</span> : problem && <span className="text-[10px] text-dim">{problem}</span>}
      {submit.isSuccess && draft.comments.length === 0 && !draft.body && <span className="text-[10px] text-ok">review submitted</span>}
      <button
        type="button"
        disabled={problem !== null || submit.isPending}
        onClick={send}
        className="flex h-8 cursor-pointer items-center justify-center border-0 bg-fg font-mono text-[10px] text-bg disabled:cursor-default disabled:opacity-40"
      >
        {submit.isPending ? "submitting" : draft.comments.length ? `submit review · ${draft.comments.length} ${draft.comments.length === 1 ? "comment" : "comments"}` : "submit review"}
      </button>
    </section>
  );
}
