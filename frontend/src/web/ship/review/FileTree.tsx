import { cn } from "cn";
import { ArrowLeft, Folder, MessageSquare, Search, Square, SquareCheck } from "lucide-react";
import { useState } from "react";
import type { DraftComment, ReviewFile, ReviewThread, ShipPr } from "@/shared/ship";
import { repoName } from "../../tasks/github/meta";
import { diffText } from "../derive";
import { byFolder } from "./derive";

export function FileTree(p: {
  pr: ShipPr;
  files: readonly ReviewFile[];
  threads: readonly ReviewThread[];
  pending: readonly DraftComment[];
  current: string | null;
  onOpen: (path: string) => void;
  onViewed: (file: ReviewFile) => void;
  onBack: () => void;
}) {
  const [filter, setFilter] = useState("");
  const viewed = p.files.filter(f => f.viewed).length;
  const shown = filter.trim() ? p.files.filter(f => f.path.toLowerCase().includes(filter.trim().toLowerCase())) : p.files;
  const notesOn = (path: string) => p.threads.filter(t => t.path === path && !t.resolved).length + p.pending.filter(c => c.path === path).length;

  return (
    <aside aria-label="changed files" className="hidden w-[300px] shrink-0 flex-col border-r border-rule md:flex">
      <div className="flex flex-col gap-2 border-b border-rule px-4 py-3.5">
        <span className="flex items-center justify-between text-[10px] text-dim">
          <button type="button" onClick={p.onBack} className="flex cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 font-mono text-[10px] text-dim hover:text-fg">
            <ArrowLeft aria-hidden className="size-3" />
            queue
          </button>
          <a href={p.pr.url} target="_blank" rel="noreferrer" data-external className="text-dim no-underline hover:text-fg">
            {repoName(p.pr.repo)} #{p.pr.number}
          </a>
        </span>
        <h2 className="m-0 text-[12px] leading-[1.4] font-semibold break-words">{p.pr.title}</h2>
        <span className="flex justify-between text-[10px] text-dim">
          <span>
            {viewed} / {p.files.length} viewed
          </span>
          <span>{diffText(p.pr)}</span>
        </span>
        <span aria-hidden className="h-0.5 bg-track">
          <span className="block h-full bg-fg" style={{ width: `${p.files.length ? (viewed / p.files.length) * 100 : 0}%` }} />
        </span>
      </div>
      <label className="flex items-center gap-2 border-b border-rule px-4 py-2.5">
        <Search aria-hidden className="size-3 text-dim" />
        <input
          type="search"
          aria-label="filter files"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="filter files"
          className="min-w-0 flex-1 border-0 bg-transparent font-mono text-[11px] text-fg outline-none placeholder:text-dim"
        />
      </label>
      <nav className="min-h-0 flex-1 overflow-y-auto py-1.5">
        {byFolder(shown).map(g => (
          <div key={g.folder}>
            {g.folder && (
              <span className="flex items-center gap-1.5 px-4 pt-2 pb-1 text-[10px] break-all text-dim">
                <Folder aria-hidden className="size-3 shrink-0" />
                {g.folder}
              </span>
            )}
            {g.files.map(f => {
              const Box = f.viewed ? SquareCheck : Square;
              const active = f.path === p.current;
              const notes = notesOn(f.path);
              return (
                <div key={f.path} data-file={f.path} className={cn("flex items-center gap-2 py-1 pr-4 pl-[26px]", active ? "bg-lift shadow-[inset_2px_0_0_var(--color-fg)]" : "hover:bg-hover")}>
                  <button type="button" aria-label={`${f.viewed ? "unmark" : "mark"} ${f.name} viewed`} aria-pressed={f.viewed} onClick={() => p.onViewed(f)} className="flex cursor-pointer border-0 bg-transparent p-0">
                    <Box aria-hidden className={cn("size-3", f.viewed ? "text-ok" : "text-faint hover:text-fg")} />
                  </button>
                  <button
                    type="button"
                    aria-current={active ? "true" : undefined}
                    onClick={() => p.onOpen(f.path)}
                    title={f.path}
                    className={cn("min-w-0 flex-1 cursor-pointer truncate border-0 bg-transparent p-0 text-left font-mono text-[10px]", f.viewed && !active ? "text-dim" : "text-fg")}
                  >
                    {f.name}
                  </button>
                  {notes > 0 && (
                    <span className="flex items-center gap-0.5 text-[10px] text-warn">
                      <MessageSquare aria-hidden className="size-2.5" />
                      {notes}
                    </span>
                  )}
                  <span className="text-[10px] text-ok">+{f.additions}</span>
                  <span className="text-[10px] text-bad">−{f.deletions}</span>
                </div>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="flex gap-3.5 border-t border-rule px-4 py-2 text-[9px] text-dim">
        {["n p file", "v viewed", "u layout", "c colours", "esc queue"].map(k => (
          <span key={k}>{k}</span>
        ))}
      </div>
    </aside>
  );
}
