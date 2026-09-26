import { cn } from "cn";
import { Eye, GitPullRequest, Globe, Search, SquareCheck, Square, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { SHIP_QUEUES, SHIP_STATES, type ShipPr, type ShipQueue, type ShipSnapshot } from "@/shared/ship";
import { navigate, reviewHref, shipHref, usePeek } from "../router";
import { useSettings } from "../settings";
import { useUi } from "../store";
import { repoName } from "../tasks/github/meta";
import { FilterTabs, Freshness, SidebarSection, Unavailable } from "../tasks/ui/Layout";
import { useRequestMe, useShip, useShipSearch } from "./api";
import { countBy, groupMine, groupReview, narrow, STATE_LABEL, STATE_TONE, step, type Group } from "./derive";
import { PrPreview } from "./PrPreview";
import { PrTable } from "./PrTable";
import { Readiness } from "./Readiness";
import { useShipUi } from "./store";
import { toneDot } from "./tone";
import { SidePanel } from "../shell/SidePanel";

const QUEUE_ICON: Record<ShipQueue, LucideIcon> = { mine: GitPullRequest, review: Eye, all: Globe };

function useDebounced<T>(value: T, ms: number): T {
  const [out, setOut] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setOut(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return out;
}

function typing(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
}

export function ShipView({ queue }: { queue: ShipQueue }) {
  const { data: snap } = useShip();
  const { staleAfterMs } = useSettings().tasks;
  const text = useShipUi(s => s.text[queue]);
  const query = useDebounced(text, 300);
  const search = useShipSearch(query, queue === "all");
  const request = useRequestMe();
  const [copied, setCopied] = useState(false);
  const searchBox = useRef<HTMLInputElement>(null);
  const { selected, state, hiddenRepos, select, setText, setState, toggleRepo } = useShipUi();
  const peeking = usePeek() !== null;

  const ready = snap?.kind === "ready" ? snap : null;
  const org = useSettings().ship.org ?? "";
  const source: readonly ShipPr[] = queue === "mine" ? (ready?.mine ?? []) : queue === "review" ? (ready?.review ?? []) : search.data?.kind === "ready" ? search.data.prs : [];
  const shown = narrow(source, { text: queue === "all" ? "" : text, state: queue === "mine" ? state : null, hiddenRepos });
  const groups: Group[] = queue === "mine" ? groupMine(shown) : queue === "review" ? groupReview(shown) : shown.length ? [{ id: "matches", label: "matches", tone: "fg", prs: shown }] : [];
  const ids = groups.flatMap(g => g.prs.map(p => p.id));
  const everything = [...(ready?.mine ?? []), ...(ready?.review ?? []), ...(search.data?.kind === "ready" ? search.data.prs : [])];
  const current = everything.find(p => p.id === selected) ?? null;

  const requestMe = (pr: ShipPr) => pr.relation === "none" && request.mutate(pr.id);
  const copy = (pr: ShipPr) => {
    void navigator.clipboard.writeText(pr.url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  const move = (by: 1 | -1) => select(step(ids, selected, by));

  useEffect(() => {
    if (selected) document.querySelector(`[data-pr="${CSS.escape(selected)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || useUi.getState().paletteOpen) return;
      if (typing(e.target)) {
        if (e.key === "Escape" && e.target === searchBox.current) {
          setText(queue, "");
          searchBox.current?.blur();
        }
        return;
      }
      const queueKey = SHIP_QUEUES[Number(e.key) - 1];
      if (queueKey) navigate(shipHref(queueKey));
      else if (e.key === "j" || e.key === "ArrowDown") move(1);
      else if (e.key === "k" || e.key === "ArrowUp") move(-1);
      else if (e.key === "/") searchBox.current?.focus();
      else if (e.key === "Escape") select(null);
      else if (current && e.key === "Enter") window.open(current.url, "_blank", "noopener");
      else if (current && e.key === "f") navigate(reviewHref(queue, current.id));
      else if (current && e.key === "r") requestMe(current);
      else if (current && e.key === "c") copy(current);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const allLabel = org || "org";
  const label = (q: ShipQueue) => ({ mine: "mine", review: "waiting on you", all: allLabel })[q];
  const counts: Record<ShipQueue, number | undefined> = {
    mine: ready?.mine.length,
    review: ready?.review.length,
    all: search.data?.kind === "ready" && query === "" ? search.data.total : undefined,
  };
  const placeholder = queue === "all" ? `search ${allLabel}: title, author:login, label:x` : `filter ${label(queue)}`;
  const error = request.error?.message ?? (search.data?.kind === "unavailable" ? search.data.reason : null);

  return (
    <>
      <SidePanel id="ship-sidebar" label="ship sidebar" className="hidden md:flex">
        <SidebarSection title="queues">
          {SHIP_QUEUES.map((q, i) => (
            <QueueLink key={q} queue={q} label={label(q)} count={counts[q]} active={q === queue} hotkey={i + 1} rereview={q === "review" ? (ready?.review.filter(p => p.relation === "rereview").length ?? 0) : 0} />
          ))}
        </SidebarSection>
        <SidebarSection title="ship state" right={queue === "mine" ? undefined : "mine only"}>
          {SHIP_STATES.map(s => {
            const n = ready?.mine.filter(p => p.state === s).length ?? 0;
            const on = state === s;
            return (
              <button
                key={s}
                type="button"
                disabled={queue !== "mine"}
                aria-pressed={on}
                onClick={() => setState(on ? null : s)}
                className={cn(
                  "-mx-2 flex cursor-pointer items-center justify-between border-0 bg-transparent px-2 py-0.5 font-mono text-[11px] disabled:cursor-default disabled:opacity-35",
                  on ? "bg-lift text-fg" : "text-fg hover:bg-hover",
                )}
              >
                <span className="flex items-center gap-2">
                  <span className={cn("size-[7px] rounded-full", toneDot[STATE_TONE[s]])} />
                  {STATE_LABEL[s]}
                </span>
                <span className="text-[10px] text-dim">{n}</span>
              </button>
            );
          })}
        </SidebarSection>
        <SidebarSection title="repos">
          {countBy(source, p => p.repo).map(([repo, n]) => {
            const hidden = hiddenRepos.includes(repo);
            const Box = hidden ? Square : SquareCheck;
            return (
              <button key={repo} type="button" aria-pressed={!hidden} onClick={() => toggleRepo(repo)} className="flex cursor-pointer items-center justify-between border-0 bg-transparent p-0 font-mono text-[11px]">
                <span className={cn("flex items-center gap-2", hidden ? "text-dim" : "text-fg")}>
                  <Box aria-hidden className="size-3" />
                  {repoName(repo)}
                </span>
                <span className="text-[10px] text-dim">{n}</span>
              </button>
            );
          })}
        </SidebarSection>
        <Readiness queue={queue} />
      </SidePanel>
      <main className="@container flex min-w-0 flex-1 flex-col pb-[env(safe-area-inset-bottom)]">
        <div className="flex min-h-11 shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-rule px-4 py-2 md:flex-nowrap md:px-5">
          <div className="w-full md:hidden">
            <FilterTabs<ShipQueue> label="queue" value={queue} onChange={q => navigate(shipHref(q))} options={SHIP_QUEUES.map(q => ({ value: q, label: label(q), count: counts[q] }))} />
          </div>
          <label className="flex h-7 min-w-0 flex-1 items-center gap-2 border border-rule px-2.5 focus-within:border-fg">
            <Search aria-hidden className="size-3 shrink-0 text-dim" />
            <input
              ref={searchBox}
              type="search"
              aria-label={queue === "all" ? `search ${allLabel}` : `filter ${label(queue)}`}
              value={text}
              onChange={e => setText(queue, e.target.value)}
              placeholder={placeholder}
              className="min-w-0 flex-1 border-0 bg-transparent font-mono text-[11px] text-fg outline-none placeholder:text-dim"
            />
            <span className="hidden font-key text-[10px] text-faint md:inline">/</span>
          </label>
          <div className="flex shrink-0 items-center gap-2 text-[10px] whitespace-nowrap text-dim">
            {error ? (
              <span className="max-w-[320px] truncate text-bad" title={error}>
                {error}
              </span>
            ) : copied ? (
              <span className="text-ok">link copied</span>
            ) : queue === "all" && search.isFetching ? (
              <span>searching</span>
            ) : queue === "all" && search.data?.kind === "ready" ? (
              <span>
                {search.data.total} {search.data.total === 1 ? "match" : "matches"}
              </span>
            ) : (
              ready && <Freshness label="github synced" at={ready.fetchedAt} staleAfterMs={staleAfterMs} />
            )}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <Body snap={snap} queue={queue} groups={groups} sourceSize={source.length} searching={queue === "all" && search.isPending}>
            <PrTable queue={queue} groups={groups} selected={selected} onSelect={select} onRequest={requestMe} requesting={request.isPending ? (request.variables ?? null) : null} />
          </Body>
        </div>
        <div className="hidden shrink-0 flex-wrap gap-x-[18px] gap-y-1 border-t border-rule px-5 py-2 text-[9px] whitespace-nowrap text-dim md:flex">
          {["j k move", "f review files", "p open in px0", "↵ open on github", "r request me", "c copy link", "/ search", "1 2 3 queues", "esc close"].map(k => (
            <span key={k}>{k}</span>
          ))}
        </div>
      </main>
      {current && !peeking && (
        <PrPreview
          pr={current}
          onClose={() => select(null)}
          onStep={move}
          onRequest={requestMe}
          requesting={request.isPending && request.variables === current.id}
          onCopy={copy}
          onReview={pr => navigate(reviewHref(queue, pr.id))}
        />
      )}
    </>
  );
}

function Body({ snap, queue, groups, sourceSize, searching, children }: { snap: ShipSnapshot | undefined; queue: ShipQueue; groups: readonly Group[]; sourceSize: number; searching: boolean; children: React.ReactNode }) {
  if (queue !== "all" && !snap) return <Unavailable reason="asking GitHub" />;
  if (snap?.kind === "unavailable") return <Unavailable reason={snap.reason} />;
  if (searching) return <Unavailable reason="searching" />;
  if (groups.length > 0) return children;
  if (sourceSize > 0) return <Unavailable reason="no pull request matches" />;
  return <Unavailable reason={{ mine: "you have no open pull requests", review: "nothing is waiting on you", all: "no pull request matches" }[queue]} />;
}

function QueueLink({ queue, label, count, active, hotkey, rereview }: { queue: ShipQueue; label: string; count: number | undefined; active: boolean; hotkey: number; rereview: number }) {
  const Icon = QUEUE_ICON[queue];
  const href = shipHref(queue);
  return (
    <a
      href={href}
      aria-current={active ? "page" : undefined}
      aria-keyshortcuts={String(hotkey)}
      onClick={e => {
        e.preventDefault();
        navigate(href);
      }}
      className={cn("-mx-2 flex flex-col gap-1 px-2 py-1.5 no-underline", active ? "bg-lift shadow-[inset_2px_0_0_var(--color-fg)]" : "hover:bg-hover")}
    >
      <span className="flex items-center justify-between gap-2 text-[11px]">
        <span className={cn("flex min-w-0 items-center gap-2 truncate", active ? "text-fg" : "text-dim")}>
          <Icon aria-hidden className="size-3 shrink-0" />
          {label}
        </span>
        {count !== undefined && <span className="text-[10px] text-dim">{count}</span>}
      </span>
      {rereview > 0 && (
        <span className="flex items-center gap-1.5 pl-5 text-[10px] text-warn">
          <span className="size-1.5 rounded-full bg-warn" />
          {rereview} re-review
        </span>
      )}
    </a>
  );
}
