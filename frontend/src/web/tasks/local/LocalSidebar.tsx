import { cn } from "cn";
import { ChevronLeft, ChevronRight, FolderSync, Plus } from "lucide-react";
import { useState } from "react";
import type { DailyNote } from "@/shared/tasks";
import { useCreateToday } from "../api";
import { useTasksUi } from "../store";
import { SegmentBar, SidebarHeader } from "../ui/Layout";
import { monthGrid, monthLabel, shortDay, weekOf } from "./derive";

export function LocalSidebar({ notes, today, carry }: { notes: readonly DailyNote[]; today: string; carry: number }) {
  const hasToday = notes.some(n => n.date === today);
  return (
    <>
      <SidebarHeader icon={FolderSync} title="Daily" />
      <Calendar notes={notes} today={today} />
      <div className="flex flex-col">
        {!hasToday && <TodayRow today={today} carry={carry} />}
        {notes.map(n => (
          <NoteRow key={n.date} note={n} isToday={n.date === today} />
        ))}
      </div>
    </>
  );
}

const DOW = ["m", "t", "w", "t", "f", "s", "s"];

function Calendar({ notes, today }: { notes: readonly DailyNote[]; today: string }) {
  const [year, month] = today.split("-").map(Number);
  const [shown, setShown] = useState({ year: year ?? 2026, month: month ?? 1 });
  const range = useTasksUi(s => s.localRange);
  const setRange = useTasksUi(s => s.setLocalRange);
  const byDate = new Map(notes.map(n => [n.date, n]));
  const week = weekOf(today);
  const step = (d: number) => setShown(s => ({ year: s.year + Math.floor((s.month - 1 + d) / 12), month: ((s.month - 1 + d + 12) % 12) + 1 }));

  return (
    <section aria-label="calendar" className="flex flex-col gap-1.5 border-b border-rule px-5 py-3.5">
      <div className="flex items-center justify-between pb-1">
        <h2 className="m-0 text-[12px] font-semibold">{monthLabel(shown.year, shown.month)}</h2>
        <span className="flex gap-1.5">
          <button type="button" aria-label="previous month" onClick={() => step(-1)} className="cursor-pointer border-0 bg-transparent p-0 text-dim hover:text-fg">
            <ChevronLeft aria-hidden className="size-3.5" />
          </button>
          <button type="button" aria-label="next month" onClick={() => step(1)} className="cursor-pointer border-0 bg-transparent p-0 text-dim hover:text-fg">
            <ChevronRight aria-hidden className="size-3.5" />
          </button>
        </span>
      </div>
      <div className="grid grid-cols-7 gap-[3px] text-center text-[9px] text-dim">
        {DOW.map((d, i) => (
          <span key={i}>{d}</span>
        ))}
      </div>
      {monthGrid(shown.year, shown.month).map((row, w) => (
        <div key={w} className="grid grid-cols-7 gap-[3px]">
          {row.map((date, i) => {
            if (!date) return <span key={i} />;
            const note = byDate.get(date);
            const selected = range.kind === "day" && range.date === date;
            const inWeek = range.kind === "week" && date >= week.from && date <= week.to;
            const c = note?.counts;
            return (
              <button
                key={date}
                type="button"
                aria-label={shortDay(date)}
                aria-pressed={selected}
                disabled={!note}
                onClick={() => setRange(selected ? { kind: "week" } : { kind: "day", date })}
                className={cn(
                  "flex h-7 cursor-pointer flex-col items-center justify-center gap-[3px] border bg-transparent p-0 font-mono text-[9px] disabled:cursor-default",
                  selected ? "border-warn" : date === today ? "border-fg" : "border-transparent",
                  inWeek && "bg-raise",
                  date === today ? "font-bold text-fg" : note ? "text-fg" : date > today ? "text-faint" : "text-dim",
                )}
              >
                {Number(date.slice(8))}
                {c && (
                  <SegmentBar
                    className="h-0.5 w-[18px] gap-0"
                    segments={[
                      { n: c.done, className: "bg-ok" },
                      { n: c.doing, className: "bg-warn" },
                      { n: c.open, className: "bg-faint" },
                    ]}
                  />
                )}
              </button>
            );
          })}
        </div>
      ))}
    </section>
  );
}

function TodayRow({ today, carry }: { today: string; carry: number }) {
  const create = useCreateToday();
  return (
    <div className="flex flex-col gap-2 border-b border-rule px-5 py-3">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-semibold">{shortDay(today)}</span>
        <span className="text-[10px] text-warn">today</span>
      </div>
      <button
        type="button"
        disabled={create.isPending}
        onClick={() => create.mutate()}
        className="flex w-fit cursor-pointer items-center gap-1.5 border border-fg bg-transparent px-2.5 py-1 font-mono text-[10px] text-fg hover:bg-raise disabled:opacity-50"
      >
        <Plus aria-hidden className="size-3" />
        {carry > 0 ? `create, carry ${carry} open` : "create today's note"}
      </button>
      {create.error && <span className="text-[10px] text-bad">{create.error.message}</span>}
    </div>
  );
}

function NoteRow({ note, isToday }: { note: DailyNote; isToday: boolean }) {
  const range = useTasksUi(s => s.localRange);
  const setRange = useTasksUi(s => s.setLocalRange);
  const selected = range.kind === "day" && range.date === note.date;
  const { done, doing, open, dropped } = note.counts;
  const total = done + doing + open;

  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => setRange(selected ? { kind: "week" } : { kind: "day", date: note.date })}
      className={cn(
        "flex cursor-pointer flex-col gap-2 border-0 border-b border-l-2 border-b-rule bg-transparent px-5 py-3 text-left font-mono hover:bg-raise",
        selected ? "border-l-fg bg-raise" : "border-l-transparent",
      )}
    >
      <span className="flex w-full items-center justify-between">
        <span className="flex items-center gap-2">
          <span className={cn("text-[12px] text-fg", isToday && "font-semibold")}>{shortDay(note.date)}</span>
          <span className="text-[9px] text-faint">{note.date.slice(5)}</span>
        </span>
        <span className="text-[10px] text-dim">{isToday ? <span className="text-warn">today</span> : `${done}/${total}`}</span>
      </span>
      {total > 0 && (
        <SegmentBar
          className="w-full"
          segments={[
            { n: done, className: "bg-ok" },
            { n: doing, className: "bg-warn" },
            { n: open, className: "bg-faint" },
          ]}
        />
      )}
      {dropped > 0 && <span className="text-[9px] text-dim">{dropped} dropped</span>}
    </button>
  );
}
