import { useQueryClient } from "@tanstack/react-query";
import { cn } from "cn";
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { citeKey, parseCiteHref } from "@/shared/cite";
import type { CitationCheck, ToolCall, ThreadSummary, Turn } from "@/shared/mirai";
import { peekOf } from "@/shared/refs";
import { clock } from "../format";
import { useIsDesktop } from "../hooks";
import { navigate, openPeek, useRoute } from "../router";
import { useUi } from "../store";
import { SidePanel } from "../shell/SidePanel";
import { answering, ask, newThread, removeThread, stop, useMirai, useMiraiStatus, useThread, useThreads } from "./api";
import { costLabel, sinceLabel, spentSince, viewLabel, type LiveTurn } from "./live";

const linkClass = "text-link no-underline hover:underline";

function CitationLink({ href, quoted, check, children }: { href: string; quoted: boolean; check: CitationCheck | undefined; children: ReactNode }) {
  const desktop = useIsDesktop();
  const last = useUi(s => s.lastCite === href);
  if (check?.status === "failed") {
    return (
      <span className="text-faint" title={check.reason ?? undefined}>
        <span className="line-through">
          {children}
          {quoted && " ¶"}
        </span>{" "}
        <span className="text-[10px]">{check.reason}</span>
      </span>
    );
  }
  return (
    <a
      href={href}
      title={check?.status === "unchecked" ? `not checked: ${check.reason ?? "nothing to check against yet"}` : undefined}
      className={cn(linkClass, last && "text-fg underline")}
      onClick={e => {
        e.preventDefault();
        const clicks = useUi.getState().citeClicks + 1;
        useUi.setState(desktop ? { lastCite: href, citeClicks: clicks } : { lastCite: href, citeClicks: clicks, mirAIOpen: false, mirAIBack: true });
        navigate(href);
      }}
    >
      {children}
      {quoted && " ¶"}
    </a>
  );
}

function AnswerLink({ href, checks, children }: { href: string | undefined; checks: ReadonlyMap<string, CitationCheck>; children: ReactNode }) {
  if (!href) return <>{children}</>;
  const cite = parseCiteHref(href);
  if (cite) {
    return (
      <CitationLink href={href} quoted={cite.target.kind === "passage"} check={checks.get(citeKey(cite))}>
        {children}
      </CitationLink>
    );
  }
  const peek = href.startsWith("/") ? null : peekOf(href);
  if (href.startsWith("/") || peek) {
    return (
      <a
        href={href}
        className={linkClass}
        onClick={e => {
          e.preventDefault();
          if (peek) openPeek(peek);
          else navigate(href);
        }}
      >
        {children}
      </a>
    );
  }
  return (
    <a href={href} target="_blank" rel="noreferrer" className={linkClass}>
      {children}
    </a>
  );
}

const answerComponents = (checks: ReadonlyMap<string, CitationCheck>): Components => ({
  p: ({ children }) => <p className="m-0 leading-[1.6]">{children}</p>,
  a: ({ href, children }) => (
    <AnswerLink href={href} checks={checks}>
      {children}
    </AnswerLink>
  ),
  ul: ({ children }) => <ul className="m-0 flex list-disc flex-col gap-1 pl-4">{children}</ul>,
  ol: ({ children }) => <ol className="m-0 flex list-decimal flex-col gap-1 pl-4">{children}</ol>,
  code: ({ children }) => <code className="text-warn">{children}</code>,
  img: () => null,
  pre: ({ children }) => <pre className="m-0 overflow-x-auto border border-rule bg-raise p-3 text-[10px] leading-[1.5]">{children}</pre>,
  table: ({ children }) => <table className="w-full border-collapse text-[10px]">{children}</table>,
  th: ({ children }) => <th className="border-b border-rule py-1 text-left font-normal text-dim">{children}</th>,
  td: ({ children }) => <td className="border-b border-rule py-1">{children}</td>,
});

const NO_CHECKS: readonly CitationCheck[] = [];

function Answer({ text, citations = NO_CHECKS }: { text: string; citations?: readonly CitationCheck[] }) {
  const components = useMemo(() => answerComponents(new Map(citations.map(c => [c.key, c]))), [citations]);
  return (
    <div className="flex min-w-0 flex-col gap-2 text-[12px] break-words">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

function CallLines({ calls }: { calls: readonly ToolCall[] }) {
  return calls.map(r => (
    <span key={r.id} className={cn("text-[11px] break-all", r.ok === false ? "text-bad" : r.change ? "text-fg" : "text-dim")}>
      {r.ok === false ? "✕" : r.change ? "✎" : "·"} {r.label}
    </span>
  ));
}

function Changes({ calls }: { calls: readonly ToolCall[] }) {
  const changes = calls.filter(r => r.change);
  return changes.length > 0 ? (
    <div className="flex flex-col gap-1">
      <CallLines calls={changes} />
    </div>
  ) : null;
}

const lookups = (calls: readonly ToolCall[]) => calls.filter(r => !r.change);

function Thinking({ text }: { text: string }) {
  return text ? <p className="m-0 text-[11px] leading-[1.6] whitespace-pre-wrap text-dim italic">{text}</p> : null;
}

function Folded({ tookMs, thinking, calls }: { tookMs: number; thinking: string; calls: readonly ToolCall[] }) {
  const [open, setOpen] = useState(false);
  if (!thinking && calls.length === 0) return null;
  return (
    <>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="cursor-pointer self-start border-0 bg-transparent p-0 font-mono text-[10px] text-dim hover:text-fg">
        thought {sinceLabel(tookMs)} · {calls.length} {calls.length === 1 ? "read" : "reads"} {open ? "▾" : "▸"}
      </button>
      {open && (
        <div className="flex flex-col gap-1.5 border-l border-rule pl-3">
          <Thinking text={thinking} />
          <CallLines calls={calls} />
        </div>
      )}
    </>
  );
}

function Question({ view, askedAt, text }: { view: string; askedAt: number; text: string }) {
  return (
    <>
      <span className="text-[10px] text-dim">
        {view ? `${view} · ` : ""}
        {clock(askedAt)}
      </span>
      <p className="m-0 border-l-2 border-fg pl-3 text-[12px] font-semibold whitespace-pre-wrap">{text}</p>
    </>
  );
}

function SettledTurn({ turn }: { turn: Turn }) {
  return (
    <section className="flex flex-col gap-2">
      <Question view={turn.view} askedAt={turn.askedAt} text={turn.question} />
      <Folded tookMs={turn.tookMs} thinking={turn.thinking} calls={lookups(turn.calls)} />
      {turn.answer && <Answer text={turn.answer} citations={turn.citations} />}
      <Changes calls={turn.calls} />
      {turn.status === "stopped" && <span className="text-[10px] text-warn">stopped</span>}
      {turn.status === "answering" && <span className="text-[10px] text-dim">answering in another tab or device</span>}
      {turn.status === "error" && <p className="m-0 text-[11px] text-bad">{turn.error}</p>}
    </section>
  );
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

function LiveTurnView({ live }: { live: LiveTurn }) {
  const running = live.error === null;
  const elapsed = useNow(running) - live.askedAt;
  return (
    <section className="flex flex-col gap-2" aria-live="polite">
      <Question view={live.view} askedAt={live.askedAt} text={live.question} />
      {live.answer ? (
        <>
          <Folded tookMs={elapsed} thinking={live.thinking} calls={lookups(live.calls)} />
          <Answer text={live.answer} />
          <Changes calls={live.calls} />
        </>
      ) : (
        <div className="flex flex-col gap-1.5 border-l border-rule pl-3">
          <span className="text-[10px] text-warn">{running ? `thinking ${sinceLabel(elapsed)}` : "thought"}</span>
          <Thinking text={live.thinking} />
          <CallLines calls={live.calls} />
        </div>
      )}
      {live.retry && <span className="text-[10px] text-dim">{live.retry}</span>}
      {live.error && <p className="m-0 text-[11px] text-bad">{live.error}</p>}
    </section>
  );
}

function ThreadView({ view }: { view: string }) {
  const { threadId, live } = useMirai();
  const status = useMiraiStatus();
  const thread = useThread(threadId, !answering(live));
  const turns = threadId && thread.data?.id === threadId ? thread.data.turns : [];
  const scroller = useRef<HTMLDivElement>(null);
  const growth = `${turns.length}:${live?.thinking.length ?? 0}:${live?.answer.length ?? 0}:${live?.calls.length ?? 0}`;

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [growth]);

  return (
    <div ref={scroller} className="flex flex-1 flex-col gap-[22px] overflow-y-auto p-5">
      {status.data?.kind === "off" && (
        <div className="flex flex-col gap-2.5">
          <span className="text-[12px] font-semibold">mirAI off</span>
          <p className="m-0 text-[11px] text-bad">{status.data.reason}</p>
        </div>
      )}
      {thread.isError && !live && <p className="m-0 text-[11px] text-bad">{thread.error.message}</p>}
      {turns.map(t => (
        <SettledTurn key={t.askedAt} turn={t} />
      ))}
      {live && <LiveTurnView live={live} />}
      {!live && turns.length === 0 && status.data?.kind === "ready" && <p className="m-0 text-dim">ask about {view}</p>}
      {turns.length > 0 && !live && thread.data && <span className="text-[10px] text-dim">thread {costLabel(thread.data.costUsd)}</span>}
    </div>
  );
}

function HistoryRow({ t, active, disabled }: { t: ThreadSummary; active: boolean; disabled: boolean }) {
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <li className={cn("flex flex-col gap-1.5 border-b border-rule py-3 pr-5", active ? "border-l-2 border-l-fg pl-[18px]" : "pl-5")}>
      <div className="flex items-start justify-between gap-3">
        <button
          type="button"
          disabled={disabled}
          onClick={() => useMirai.setState({ threadId: t.id, panel: "thread", notice: null })}
          className={cn("min-w-0 cursor-pointer border-0 bg-transparent p-0 text-left font-mono text-[12px] text-fg disabled:cursor-default", active && "font-semibold")}
        >
          {t.title}
        </button>
        {confirm ? (
          <span className="flex shrink-0 gap-2 text-[11px]">
            <button
              type="button"
              className="cursor-pointer border-0 bg-transparent p-0 font-mono text-bad"
              onClick={() => {
                removeThread(qc, t.id).catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
              }}
            >
              delete
            </button>
            <button type="button" className="cursor-pointer border-0 bg-transparent p-0 font-mono text-dim hover:text-fg" onClick={() => setConfirm(false)}>
              keep
            </button>
          </span>
        ) : (
          <button type="button" aria-label={`delete thread ${t.title}`} disabled={disabled && active} onClick={() => setConfirm(true)} className="shrink-0 cursor-pointer border-0 bg-transparent p-0 font-mono text-[12px] text-dim hover:text-fg">
            ×
          </button>
        )}
      </div>
      <span className="text-[10px] text-dim">
        {[t.view, clock(t.updatedAt), `${t.questions} q`, costLabel(t.costUsd)].filter(Boolean).join(" · ")}
      </span>
      {error && <span className="text-[10px] text-bad">{error}</span>}
    </li>
  );
}

function HistoryView() {
  const { threadId, live } = useMirai();
  const threads = useThreads(true);
  const weekAgo = Date.now() - 7 * 86_400_000;
  const list = threads.data ?? [];
  const week = list.reduce((sum, t) => sum + spentSince(t.spend, weekAgo), 0);
  return (
    <>
      <div className="flex flex-1 flex-col overflow-y-auto py-2">
        {threads.isError && <p className="m-0 px-5 text-[11px] text-bad">{threads.error.message}</p>}
        {threads.data && list.length === 0 && <p className="m-0 px-5 text-dim">no threads yet</p>}
        <ul className="m-0 list-none p-0">
          {list.map(t => (
            <HistoryRow key={t.id} t={t} active={t.id === threadId} disabled={answering(live)} />
          ))}
        </ul>
      </div>
      {threads.data && (
        <div className="border-t border-rule px-5 py-3.5 text-[11px] text-dim">
          {list.length} {list.length === 1 ? "thread" : "threads"} · {costLabel(week)} this week
        </div>
      )}
    </>
  );
}

function Composer({ view }: { view: string }) {
  const qc = useQueryClient();
  const { threadId, live, notice } = useMirai();
  const status = useMiraiStatus();
  const thread = useThread(threadId, !answering(live));
  const [text, setText] = useState("");
  const busy = answering(live);
  const elsewhere = !live && thread.data?.busy === true;
  const off = status.data?.kind === "off";

  const send = (e?: FormEvent) => {
    e?.preventDefault();
    const q = text.trim();
    if (!q || busy || elsewhere || off) return;
    setText("");
    void ask(qc, q, view).then(ok => {
      if (!ok) setText(current => current || q);
    });
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) send(e);
  };

  if (busy) {
    return (
      <div className="flex items-center justify-between border-t border-rule px-5 py-3.5 text-[11px]">
        <span className="text-dim">mirAI is answering</span>
        <button type="button" onClick={() => live?.threadId && void stop(qc, live.threadId)} className="cursor-pointer border-0 bg-transparent p-0 font-mono text-[11px] text-bad">
          stop esc
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={send} className="flex flex-col gap-1.5 border-t border-rule px-5 py-3.5">
      {notice && <span className="text-[11px] text-warn">{notice}</span>}
      {elsewhere ? (
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-dim">answering in another tab or device</span>
          <span className="flex gap-3.5">
            <button type="button" onClick={() => threadId && void stop(qc, threadId)} className="cursor-pointer border-0 bg-transparent p-0 font-mono text-[11px] text-bad">
              stop
            </button>
            <button type="button" onClick={newThread} className="cursor-pointer border-0 bg-transparent p-0 font-mono text-[11px] text-fg">
              new
            </button>
          </span>
        </div>
      ) : (
        <div className="flex items-end justify-between gap-3">
          <textarea
            aria-label="ask mirAI"
            rows={Math.min(4, text.split("\n").length)}
            value={text}
            disabled={off}
            onChange={e => setText(e.target.value)}
            onKeyDown={onKey}
            placeholder={off ? "mirAI is off" : `ask mirAI about ${view}`}
            className="min-w-0 flex-1 resize-none border-0 bg-transparent p-0 font-mono text-[11px] text-fg outline-none placeholder:text-dim"
          />
          <button type="submit" disabled={off || !text.trim()} aria-label="send" className="cursor-pointer border-0 bg-transparent p-0 font-mono text-[11px] text-fg disabled:cursor-default disabled:text-dim">
            ↵
          </button>
        </div>
      )}
    </form>
  );
}

function HeaderButton({ children, onClick, disabled = false, pressed }: { children: ReactNode; onClick: () => void; disabled?: boolean; pressed?: boolean }) {
  return (
    <button type="button" aria-pressed={pressed} disabled={disabled} onClick={onClick} className="-m-1 cursor-pointer border-0 bg-transparent p-1 font-mono text-[11px] text-dim hover:text-fg disabled:cursor-default disabled:hover:text-dim">
      {children}
    </button>
  );
}

function MirAIPanel() {
  const qc = useQueryClient();
  const route = useRoute();
  const openContent = useUi(s => s.openContent);
  const view = viewLabel(route, route.module === "later" ? openContent : null);
  const draft = useUi(s => s.mirAIDraft);
  const setOpen = useUi(s => s.setMirAIOpen);
  const { panel, live } = useMirai();

  useEffect(() => {
    if (!draft) return;
    useUi.setState({ mirAIDraft: "" });
    void ask(qc, draft, view);
  }, [draft, view, qc]);

  const running = answering(live) ? live?.threadId : null;
  useEffect(() => {
    if (!running) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      void stop(qc, running);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [running, qc]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-rule px-5 py-4">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-[13px]">
            mir<b className="font-bold">AI</b>
          </span>
          <span className="truncate text-[10px] text-warn">sees: {view}</span>
        </div>
        <div className="flex shrink-0 gap-3.5">
          <HeaderButton pressed={panel === "history"} onClick={() => useMirai.setState({ panel: panel === "history" ? "thread" : "history" })}>
            {panel === "history" ? "thread" : "history"}
          </HeaderButton>
          <HeaderButton disabled={answering(live)} onClick={newThread}>
            new
          </HeaderButton>
          <HeaderButton onClick={() => setOpen(false)}>close</HeaderButton>
        </div>
      </div>
      {panel === "history" ? (
        <HistoryView />
      ) : (
        <>
          <ThreadView view={view} />
          <Composer view={view} />
        </>
      )}
    </div>
  );
}

export function MirAISidebar() {
  const open = useUi(s => s.mirAIOpen);
  const setOpen = useUi(s => s.setMirAIOpen);
  const desktop = useIsDesktop();

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('textarea[aria-label="ask mirAI"]')?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open]);
  if (desktop) {
    return open ? (
      <SidePanel id="mirai" label="mirAI" className="flex">
        <MirAIPanel />
      </SidePanel>
    ) : null;
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent
        side="right"
        showCloseButton={false}
        aria-label="mirAI"
        className="w-full gap-0 border-rule bg-bg pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] font-mono sm:max-w-none"
      >
        <SheetTitle className="sr-only">mirAI</SheetTitle>
        <SheetDescription className="sr-only">Ask mirAI about what is on screen</SheetDescription>
        <MirAIPanel />
      </SheetContent>
    </Sheet>
  );
}
