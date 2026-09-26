import { cn } from "cn";
import { ListTree } from "lucide-react";
import type { ReactNode } from "react";
import type { LocalState, LocalTask } from "@/shared/tasks";
import { imageEmbeds, unwrapWikiLinks } from "@/shared/wikilinks";
import { useSettings } from "../../settings";
import { useLocalTasks, useMoveLocal, useTaskOrder } from "../api";
import { useTasksUi, type LocalRange } from "../store";
import { Kanban, type KanbanColumn } from "../ui/Kanban";
import { FilterTabs, Freshness, TasksLayout, Unavailable } from "../ui/Layout";
import { LinkPieces } from "../ui/Links";
import { VaultImages } from "../ui/VaultImages";
import { ageDays, carryable, inRange, shortDay } from "./derive";
import { LocalDrawer, localGlyph } from "./LocalDrawer";
import { LocalSidebar } from "./LocalSidebar";

type LocalColumn = "open" | "doing" | "done";
const COLUMNS: readonly KanbanColumn<LocalColumn>[] = [
  { id: "open", label: "open", glyph: "open" },
  { id: "doing", label: "doing", glyph: "doing" },
  { id: "done", label: "done", glyph: "done" },
];
const columnOf = (t: LocalTask): LocalColumn => (t.state === "dropped" ? "done" : t.state);
const stateFor: Record<LocalColumn, LocalState> = { open: "open", doing: "doing", done: "done" };

type RangeTab = "today" | "week" | "all";
const tabOf = (r: LocalRange, today: string): RangeTab | "day" => (r.kind === "day" ? (r.date === today ? "today" : "day") : r.kind);

export function LocalTasks() {
  const { data, isPending } = useLocalTasks();
  const { carryDays } = useSettings().tasks;
  const move = useMoveLocal();
  const order = useTaskOrder("local");
  const range = useTasksUi(s => s.localRange);
  const setRange = useTasksUi(s => s.setLocalRange);
  const selectedId = useTasksUi(s => s.selected.local);
  const select = useTasksUi(s => s.select);

  if (isPending || !data) return <TasksLayout board="local" sidebar={null}><Unavailable reason="reading daily notes" /></TasksLayout>;
  if (data.kind === "unavailable") return <TasksLayout board="local" sidebar={null}><Unavailable reason={`daily notes unavailable: ${data.reason}`} /></TasksLayout>;

  const { today } = data;
  const tasks = data.tasks.filter(t => inRange(t.date, range, today));
  const selected = data.tasks.find(t => t.id === selectedId) ?? null;
  const tab = tabOf(range, today);

  return (
    <TasksLayout
      board="local"
      sidebar={<LocalSidebar notes={data.notes} today={today} carry={carryable(data.tasks, today, carryDays)} />}
      filters={
        <>
          <FilterTabs<RangeTab>
            label="range"
            value={tab === "day" ? "week" : tab}
            options={[
              { value: "today", label: "today" },
              { value: "week", label: "this week" },
              { value: "all", label: "all" },
            ]}
            onChange={v => setRange(v === "today" ? { kind: "day", date: today } : { kind: v })}
          />
          {range.kind === "day" && range.date !== today && <span className="text-[11px] text-warn">{shortDay(range.date)}</span>}
        </>
      }
      status={move.error ? <span className="text-bad">{move.error.message}</span> : <Freshness label={`${tasks.length} tasks, notes changed`} at={data.changedAt} />}
      drawer={selected && <LocalDrawer task={selected} onClose={() => select("local", null)} />}
    >
      <Kanban
        label="daily tasks"
        columns={COLUMNS}
        items={tasks}
        keyOf={t => t.id}
        columnOf={columnOf}
        glyphOf={t => localGlyph[t.state]}
        renderCard={t => <LocalCard task={t} today={today} />}
        onMove={(t, to) => move.mutate({ date: t.date, line: t.line, raw: t.raw, to: stateFor[to] })}
        selected={selectedId}
        order={{ ...order, rankOf: t => t.title }}
        onSelect={id => select("local", id)}
      />
    </TasksLayout>
  );
}

export function LocalCard({ task, today, badge }: { task: LocalTask; today: string; badge?: ReactNode }) {
  const age = ageDays(task.date, today);
  const finished = task.state === "done" || task.state === "dropped";
  const title = imageEmbeds(task.title);
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className={cn("text-[12px] leading-[1.5] break-words", finished ? "text-dim" : "text-fg", task.state === "dropped" && "line-through")}>{unwrapWikiLinks(title.text) || "untitled"}</span>
      <VaultImages names={title.images} className="max-h-28" />
      <span className="flex flex-wrap items-center gap-x-2.5 text-[10px] text-dim">
        {badge}
        <span>{shortDay(task.date)}</span>
        {!finished && age > 0 && <span className={cn(age >= 2 && "text-warn")}>{age}d old</span>}
        {task.state === "dropped" && <span>dropped</span>}
        {task.subtasks.total > 0 && (
          <span className="flex items-center gap-1">
            <ListTree aria-hidden className="size-2.5" />
            {task.subtasks.done}/{task.subtasks.total}
          </span>
        )}
      </span>
      <LinkPieces links={task.links} />
    </div>
  );
}
