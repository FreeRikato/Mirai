import { cn } from "cn";
import { CodeXml, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Px0Session } from "@/shared/px0";
import { ago } from "../format";
import { repoName } from "../tasks/github/meta";
import { showPx0, usePx0Sessions, useStopPx0 } from "./api";

export const px0Summary = (s: Px0Session): string =>
  [s.viewing ? "open in a tab" : s.ready ? `idle ${ago(s.lastUsedAt)}`.replace("idle now", "just used") : "starting", s.rssMb === null ? null : `${s.rssMb} MB`].filter(Boolean).join(" · ");

const CLOSED_POLL_MS = 60_000;

export function Px0Menu() {
  const [open, setOpen] = useState(false);
  const { data } = usePx0Sessions(open ? undefined : CLOSED_POLL_MS);
  const stop = useStopPx0();
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => e.target instanceof Node && !box.current?.contains(e.target) && setOpen(false);
    const escape = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const sessions = data?.sessions ?? [];
  if (!data || sessions.length === 0) return null;
  const totalMb = sessions.reduce((n, s) => n + (s.rssMb ?? 0), 0);

  return (
    <div ref={box} className="relative hidden shrink-0 md:block">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        className="flex h-[26px] cursor-pointer items-center gap-1.5 border border-fg bg-transparent px-2 font-mono text-[11px] text-fg"
      >
        <CodeXml aria-hidden className="size-3" />
        px0 {sessions.length}
      </button>
      {open && (
        <section aria-label="px0 running" className="absolute top-[34px] right-0 z-50 w-[360px] border border-fg bg-bg font-mono text-[11px]">
          <header className="flex justify-between border-b border-rule px-3.5 py-2.5">
            <span>px0 running</span>
            <span className="text-dim">{totalMb} MB total</span>
          </header>
          {sessions.map(s => {
            const label = `${repoName(s.repo)} #${s.number}`;
            return (
              <div key={s.id} className="flex items-center gap-2.5 border-b border-rule px-3.5 py-2.5">
                <span className={cn("size-1.5 shrink-0 rounded-full", s.viewing ? "bg-ok" : "bg-dim")} />
                <a
                  href={s.path}
                  onClick={e => {
                    e.preventDefault();
                    setOpen(false);
                    showPx0(s);
                  }}
                  className="flex min-w-0 flex-1 flex-col gap-0.5 text-fg no-underline hover:underline">
                  <span className="truncate">{label}</span>
                  <span className="truncate text-[10px] text-dim">{px0Summary(s)}</span>
                </a>
                <button
                  type="button"
                  aria-label={`stop px0 for ${label}`}
                  disabled={!s.ready || (stop.isPending && stop.variables === s.id)}
                  onClick={() => stop.mutate(s.id)}
                  className="flex size-[22px] shrink-0 cursor-pointer items-center justify-center border border-rule bg-transparent text-dim hover:border-fg hover:text-fg disabled:cursor-default disabled:opacity-40"
                >
                  <Square aria-hidden className="size-2.5" />
                </button>
              </div>
            );
          })}
          <footer className="px-3.5 py-2 text-[10px] text-dim">stops itself after {Math.round(data.idleMs / 60_000)} min with no tab open</footer>
        </section>
      )}
    </div>
  );
}
