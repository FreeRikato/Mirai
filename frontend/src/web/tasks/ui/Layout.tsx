import { cn } from "cn";
import { FolderGit2, Layers, NotebookPen, Ticket, type LucideIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { TASK_BOARDS, isTaskBoard, type TaskBoard, type TaskSource } from "@/shared/tasks";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ago } from "../../format";
import { navigate, tasksHref, usePeek } from "../../router";
import { PeekDrawer, Priority } from "../priority/Priority";
import { useTasksUi } from "../store";
import { SidePanel } from "../../shell/SidePanel";

export const SOURCE_ICON: Record<TaskSource, LucideIcon> = { local: NotebookPen, linear: Ticket, github: FolderGit2 };
const BOARD_ICON: Record<TaskBoard, LucideIcon> = { all: Layers, ...SOURCE_ICON };

export function TasksLayout({ board, sidebar, filters, status, drawer, children }: { board: TaskBoard; sidebar: ReactNode; filters?: ReactNode; status?: ReactNode; drawer?: ReactNode; children: ReactNode }) {
  const peek = useTasksUi(s => s.peek);
  const linkPeek = usePeek();
  return (
    <>
      <SidePanel id="tasks-sidebar" label={`${board} sidebar`} className="hidden md:flex">
        {sidebar}
        <Priority board={board} />
      </SidePanel>
      <main className="flex min-w-0 flex-1 flex-col pb-[env(safe-area-inset-bottom)]">
        <div className="flex min-h-11 shrink-0 flex-wrap items-center justify-between gap-x-5 gap-y-2 border-b border-rule px-4 py-2 md:flex-nowrap md:px-5 md:py-0">
          <div className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-2 md:flex-nowrap">
            <SourceSwitch board={board} />
            {filters}
          </div>
          {status && <div className="flex shrink-0 items-center gap-2 text-[10px] whitespace-nowrap text-dim">{status}</div>}
        </div>
        {children}
      </main>
      {linkPeek ? null : peek ? <PeekDrawer {...peek} /> : drawer}
    </>
  );
}

function SourceSwitch({ board }: { board: TaskBoard }) {
  return (
    <ToggleGroup
      type="single"
      value={board}
      onValueChange={v => isTaskBoard(v) && navigate(tasksHref(v))}
      aria-label="task source"
      className="border border-rule"
    >
      {TASK_BOARDS.map(s => {
        const Icon = BOARD_ICON[s];
        return (
          <ToggleGroupItem
            key={s}
            value={s}
            className="h-[26px] cursor-pointer gap-1.5 px-2.5 font-mono text-[11px] text-dim hover:text-fg data-[state=on]:bg-fg data-[state=on]:font-semibold data-[state=on]:text-bg"
          >
            <Icon aria-hidden className="size-3" />
            {s}
          </ToggleGroupItem>
        );
      })}
    </ToggleGroup>
  );
}

export function FilterTabs<V extends string>({ label, value, options, onChange }: { label: string; value: V; options: readonly { value: V; label: string; count?: number }[]; onChange: (v: V) => void }) {
  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={v => {
        const hit = options.find(o => o.value === v);
        if (hit) onChange(hit.value);
      }}
      aria-label={label}
      className="h-11 gap-4"
    >
      {options.map(o => (
        <ToggleGroupItem
          key={o.value}
          value={o.value}
          className="h-full cursor-pointer gap-1.5 border-b-2 border-transparent font-mono text-[11px] text-dim hover:text-fg data-[state=on]:border-fg data-[state=on]:font-semibold data-[state=on]:text-fg"
        >
          {o.label}
          {o.count !== undefined && <span className="font-normal text-dim">{o.count}</span>}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

export const since = (at: number, now = Date.now()) => (ago(at, now) === "now" ? "just now" : `${ago(at, now)} ago`);

function useNow(everyMs = 30_000): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}

export function Freshness({ label, at, staleAfterMs }: { label: string; at: number; staleAfterMs?: number }) {
  const now = useNow();
  return (
    <>
      {staleAfterMs !== undefined && <span className={cn("size-1.5 rounded-full", now - at > staleAfterMs ? "bg-warn" : "bg-ok")} />}
      <span>
        {label} {since(at, now)}
      </span>
    </>
  );
}

export function Unavailable({ reason }: { reason: string }) {
  return <p className="m-0 p-5 text-dim">{reason}</p>;
}

export function SidebarHeader({ icon: Icon, title }: { icon: LucideIcon; title: string }) {
  return (
    <div className="flex items-center gap-2 border-b border-rule px-5 py-3.5 text-[12px] font-semibold">
      <Icon aria-hidden className="size-3.5 text-dim" />
      {title}
    </div>
  );
}

export function SidebarSection({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-2.5 border-b border-rule px-5 py-3.5">
      <div className="flex items-center justify-between">
        <h2 className="m-0 text-[12px] font-semibold">{title}</h2>
        {right && <span className="text-[10px] text-dim">{right}</span>}
      </div>
      {children}
    </section>
  );
}

export function CountRow({ icon, label, count }: { icon?: ReactNode; label: ReactNode; count: number }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="flex min-w-0 items-center gap-2 truncate text-[11px] text-dim">
        {icon}
        {label}
      </span>
      <span className="text-[10px] text-dim">{count}</span>
    </div>
  );
}

export function SegmentBar({ segments, className }: { segments: readonly { n: number; className: string }[]; className?: string }) {
  return (
    <div className={cn("flex h-[3px] gap-0.5", className)} aria-hidden>
      {segments.flatMap(s => Array.from({ length: s.n }, (_, i) => <span key={`${s.className}${i}`} className={cn("h-full min-w-0 flex-1", s.className)} />))}
    </div>
  );
}

export function ScoreBar({ score, label }: { score: number; label: string }) {
  return (
    <span role="img" aria-label={`${label} ${score.toFixed(1)} of 3`} className="flex shrink-0 gap-0.5">
      {[1, 2, 3].map(step => (
        <span key={step} className={cn("h-[3px] w-2", score >= step - 0.25 ? "bg-fg" : "bg-rule")} />
      ))}
    </span>
  );
}
