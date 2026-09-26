import { cn } from "cn";
import { useSettings } from "../../settings";
import { PenLine, SquareCheck, Ticket, UserRound } from "lucide-react";
import type { ReactNode } from "react";
import type { LinearColumn, LinearIssue, LinearPriority } from "@/shared/tasks";
import { useLinearTasks, useMoveLinear, useTaskOrder } from "../api";
import { countBy, currentCycle, owned, ownershipCounts } from "../derive";
import { useTasksUi, type Ownership } from "../store";
import { GlyphIcon } from "../ui/Glyph";
import { Kanban, type KanbanColumn } from "../ui/Kanban";
import { CountRow, FilterTabs, Freshness, SegmentBar, SidebarHeader, SidebarSection, TasksLayout, Unavailable } from "../ui/Layout";
import { LinkPieces } from "../ui/Links";
import { shortDay } from "../local/derive";
import { LinearDrawer } from "./LinearDrawer";
import { linearGlyph, PRIORITY, who } from "./meta";

const COLUMNS: readonly KanbanColumn<LinearColumn>[] = [
  { id: "todo", label: "todo", glyph: "open" },
  { id: "progress", label: "in progress", glyph: "doing" },
  { id: "review", label: "in review", glyph: "review" },
  { id: "done", label: "done", glyph: "done" },
];

export function LinearTasks() {
  const { data, isPending } = useLinearTasks();
  const { staleAfterMs } = useSettings().tasks;
  const move = useMoveLinear();
  const order = useTaskOrder("linear");
  const owner = useTasksUi(s => s.linearOwner);
  const setOwner = useTasksUi(s => s.setLinearOwner);
  const selectedId = useTasksUi(s => s.selected.linear);
  const select = useTasksUi(s => s.select);

  if (isPending || !data) return <TasksLayout board="linear" sidebar={null}><Unavailable reason="asking Linear" /></TasksLayout>;
  if (data.kind === "unavailable") return <TasksLayout board="linear" sidebar={null}><Unavailable reason={data.reason} /></TasksLayout>;

  const counts = ownershipCounts(data.issues, who);
  const issues = owned(data.issues, owner, who);
  const selected = data.issues.find(i => i.id === selectedId) ?? null;

  return (
    <TasksLayout
      board="linear"
      sidebar={<LinearSidebar issues={data.issues} />}
      filters={
        <FilterTabs<Ownership>
          label="whose issues"
          value={owner}
          onChange={setOwner}
          options={[
            { value: "all", label: "all", count: counts.all },
            { value: "assigned", label: "assigned to me", count: counts.assigned },
            { value: "created", label: "created by me", count: counts.created },
          ]}
        />
      }
      status={move.error ? <span className="text-bad">{move.error.message}</span> : <Freshness label="linear synced" at={data.fetchedAt} staleAfterMs={staleAfterMs} />}
      drawer={selected && <LinearDrawer issue={selected} onClose={() => select("linear", null)} />}
    >
      <Kanban
        label="linear issues"
        columns={COLUMNS}
        items={issues}
        keyOf={i => i.id}
        columnOf={i => i.column}
        glyphOf={i => linearGlyph[i.column]}
        renderCard={i => <LinearCard issue={i} />}
        onMove={(i, to) => move.mutate({ id: i.id, to })}
        selected={selectedId}
        order={{ ...order, rankOf: i => i.id }}
        onSelect={id => select("linear", id)}
      />
    </TasksLayout>
  );
}

function roleText(i: LinearIssue): string {
  const w = who(i);
  if (w.assigned && w.created) return "assigned, created";
  if (w.assigned) return i.creator ? `assigned by ${i.creator.name}` : "assigned";
  return i.assignee ? `created, ${i.assignee.name}` : "created, unassigned";
}

export function LinearCard({ issue, badge }: { issue: LinearIssue; badge?: ReactNode }) {
  const P = PRIORITY[issue.priority];
  const done = issue.column === "done";
  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5">
          {badge}
          <span className={cn("text-[10px] font-semibold", done ? "text-dim" : "text-link")}>{issue.identifier}</span>
        </span>
        <P.icon aria-label={`${issue.priority} priority`} className={cn("size-3", P.tone)} />
      </span>
      <span className={cn("text-[12px] leading-[1.5] break-words", done ? "text-dim" : "text-fg")}>{issue.title}</span>
      <span className="text-[10px] text-dim">{issue.stateName}</span>
      <span className="flex items-center gap-1.5 text-[10px] text-dim">
        {who(issue).assigned ? <UserRound aria-hidden className="size-2.5" /> : <PenLine aria-hidden className="size-2.5" />}
        {roleText(issue)}
      </span>
      <LinkPieces links={issue.links} />
    </div>
  );
}

function LinearSidebar({ issues }: { issues: readonly LinearIssue[] }) {
  const counts = ownershipCounts(issues, who);
  const cycle = currentCycle(issues);
  const inCycle = cycle ? issues.filter(i => i.cycle?.number === cycle.number) : [];
  const byColumn = (c: LinearColumn) => inCycle.filter(i => i.column === c).length;
  const priorities: LinearPriority[] = ["urgent", "high", "medium", "low", "none"];

  return (
    <>
      <SidebarHeader icon={Ticket} title="Linear" />
      <SidebarSection title="mine">
        <CountRow icon={<><SquareCheck aria-hidden className="size-3 text-fg" /><UserRound aria-hidden className="size-3" /></>} label="assigned to me" count={counts.assigned} />
        <CountRow icon={<><SquareCheck aria-hidden className="size-3 text-fg" /><PenLine aria-hidden className="size-3" /></>} label="created by me" count={counts.created} />
        {counts.both > 0 && <span className="text-[9px] text-dim">{counts.both} overlap, shown once</span>}
      </SidebarSection>
      {cycle && (
        <SidebarSection title={`cycle ${cycle.number}`} right={`ends ${shortDay(cycle.endsAt.slice(0, 10))}`}>
          <SegmentBar
            className="h-1"
            segments={[
              { n: byColumn("done"), className: "bg-ok" },
              { n: byColumn("review"), className: "bg-link" },
              { n: byColumn("progress"), className: "bg-warn" },
              { n: byColumn("todo"), className: "bg-faint" },
            ]}
          />
          <span className="flex gap-3 text-[10px] text-dim">
            {(["done", "review", "progress", "todo"] as const).map(c => (
              <span key={c} className="flex items-center gap-1">
                <GlyphIcon glyph={linearGlyph[c]} className="size-3" />
                {byColumn(c)}
              </span>
            ))}
          </span>
        </SidebarSection>
      )}
      <SidebarSection title="teams">
        {countBy(issues, i => i.team.key).map(([key, n]) => (
          <CountRow key={key} label={<><span className="font-semibold text-link">{key}</span>{issues.find(i => i.team.key === key)?.team.name}</>} count={n} />
        ))}
      </SidebarSection>
      <SidebarSection title="priority">
        {priorities.map(p => {
          const n = issues.filter(i => i.priority === p).length;
          const P = PRIORITY[p];
          return n > 0 ? <CountRow key={p} icon={<P.icon aria-hidden className={cn("size-3", P.tone)} />} label={p} count={n} /> : null;
        })}
      </SidebarSection>
    </>
  );
}
