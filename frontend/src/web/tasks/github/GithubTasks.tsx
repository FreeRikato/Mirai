import { cn } from "cn";
import { useSettings } from "../../settings";
import { BookMarked, FolderGit2, PenLine, SquareCheck, Ticket, UserRound } from "lucide-react";
import type { ReactNode } from "react";
import type { GithubColumn, GithubIssue } from "@/shared/tasks";
import { useGithubTasks, useMoveGithub, useTaskOrder } from "../api";
import { closedPerDay, countBy, owned, ownershipCounts } from "../derive";
import { useTasksUi, type Ownership } from "../store";
import { Kanban, type KanbanColumn } from "../ui/Kanban";
import { CountRow, FilterTabs, Freshness, SidebarHeader, SidebarSection, TasksLayout, Unavailable } from "../ui/Layout";
import { LinkPieces } from "../ui/Links";
import { weekdayOf } from "../local/derive";
import { GithubDrawer } from "./GithubDrawer";
import { fromLinear, githubGlyph, Label, pullRequestLinks, repoName, who } from "./meta";

const COLUMNS: readonly KanbanColumn<GithubColumn>[] = [
  { id: "open", label: "open", glyph: "open" },
  { id: "progress", label: "in progress", glyph: "doing", droppable: false },
  { id: "closed", label: "closed", glyph: "done" },
];

export function GithubTasks() {
  const { data, isPending } = useGithubTasks();
  const { staleAfterMs } = useSettings().tasks;
  const move = useMoveGithub();
  const order = useTaskOrder("github");
  const owner = useTasksUi(s => s.githubOwner);
  const setOwner = useTasksUi(s => s.setGithubOwner);
  const selectedId = useTasksUi(s => s.selected.github);
  const select = useTasksUi(s => s.select);

  if (isPending || !data) return <TasksLayout board="github" sidebar={null}><Unavailable reason="asking GitHub" /></TasksLayout>;
  if (data.kind === "unavailable") return <TasksLayout board="github" sidebar={null}><Unavailable reason={data.reason} /></TasksLayout>;

  const open = data.issues.filter(i => i.column !== "closed");
  const counts = ownershipCounts(open, who);
  const issues = owned(data.issues, owner, who);
  const selected = data.issues.find(i => i.id === selectedId) ?? null;

  return (
    <TasksLayout
      board="github"
      sidebar={<GithubSidebar issues={data.issues} />}
      filters={
        <FilterTabs<Ownership>
          label="whose issues"
          value={owner}
          onChange={setOwner}
          options={[
            { value: "all", label: "all open", count: counts.all },
            { value: "assigned", label: "assigned to me", count: counts.assigned },
            { value: "created", label: "created by me", count: counts.created },
          ]}
        />
      }
      status={move.error ? <span className="text-bad">{move.error.message}</span> : <Freshness label="github synced" at={data.fetchedAt} staleAfterMs={staleAfterMs} />}
      drawer={selected && <GithubDrawer issue={selected} onClose={() => select("github", null)} />}
    >
      <Kanban
        label="github issues"
        columns={COLUMNS}
        items={issues}
        keyOf={i => i.id}
        columnOf={i => i.column}
        glyphOf={i => githubGlyph[i.column]}
        renderCard={i => <GithubCard issue={i} />}
        onMove={(i, to) => to !== "progress" && move.mutate({ id: i.id, to })}
        selected={selectedId}
        order={{ ...order, rankOf: i => i.id }}
        onSelect={id => select("github", id)}
      />
    </TasksLayout>
  );
}

export function GithubCard({ issue, badge }: { issue: GithubIssue; badge?: ReactNode }) {
  const bot = useSettings().tasks.linearGithubBot;
  const closed = issue.column === "closed";
  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex items-center gap-1 text-[10px]">
        {badge}
        <span className="text-dim">{repoName(issue.repo)}</span>
        <span className={cn("font-semibold", closed ? "text-dim" : "text-link")}>#{issue.number}</span>
      </span>
      <span className={cn("text-[12px] leading-[1.5] break-words", closed ? "text-dim" : "text-fg")}>{issue.title}</span>
      <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[10px] text-dim">
        {issue.labels.map(l => (
          <Label key={l.name} {...l} />
        ))}
        <span className="flex items-center gap-1">
          {issue.assignedToMe ? <UserRound aria-hidden className="size-2.5" /> : <PenLine aria-hidden className="size-2.5" />}
          {issue.assignedToMe ? "assigned" : "created"}
        </span>
        {fromLinear(issue, bot) && (
          <span className="flex items-center gap-1">
            <Ticket aria-hidden className="size-2.5" />
            linear
          </span>
        )}
      </span>
      <LinkPieces links={pullRequestLinks(issue)} showRepo={false} />
    </div>
  );
}

function GithubSidebar({ issues }: { issues: readonly GithubIssue[] }) {
  const bot = useSettings().tasks.linearGithubBot;
  const open = issues.filter(i => i.column !== "closed");
  const counts = ownershipCounts(open, who);
  const mirrored = open.filter(i => fromLinear(i, bot)).length;
  const days = closedPerDay(issues.flatMap(i => i.closedAt ?? []));
  const peak = Math.max(1, ...days.map(d => d.count));

  return (
    <>
      <SidebarHeader icon={FolderGit2} title="GitHub" />
      <SidebarSection title="mine">
        <CountRow icon={<><SquareCheck aria-hidden className="size-3 text-fg" /><UserRound aria-hidden className="size-3" /></>} label="assigned to me" count={counts.assigned} />
        <CountRow icon={<><SquareCheck aria-hidden className="size-3 text-fg" /><PenLine aria-hidden className="size-3" /></>} label="created by me" count={counts.created} />
        {mirrored > 0 && (
          <span className="flex items-center gap-1.5 text-[9px] text-dim">
            <Ticket aria-hidden className="size-2.5" />
            {mirrored} mirrored from linear
          </span>
        )}
      </SidebarSection>
      <SidebarSection title="repos">
        {countBy(open, i => i.repo).map(([repo, n]) => (
          <CountRow key={repo} icon={<BookMarked aria-hidden className="size-3" />} label={<span className="text-fg">{repoName(repo)}</span>} count={n} />
        ))}
      </SidebarSection>
      <SidebarSection title="labels">
        {countBy(
          open.flatMap(i => i.labels),
          l => l.name,
        ).map(([name, n]) => (
          <CountRow key={name} label={<Label name={name} color={open.flatMap(i => i.labels).find(l => l.name === name)?.color ?? "3a3a3a"} />} count={n} />
        ))}
      </SidebarSection>
      <SidebarSection title="closed" right="last 7 days">
        <div className="flex h-6 items-end gap-[3px]" aria-label={`closed per day: ${days.map(d => d.count).join(", ")}`}>
          {days.map(d => (
            <span key={d.date} className={cn("flex-1", d.count ? "bg-ok" : "bg-rule")} style={{ height: `${Math.max(2, (d.count / peak) * 24)}px` }} />
          ))}
        </div>
        <div className="flex justify-between text-[8px] text-dim">
          {days.map(d => (
            <span key={d.date}>{weekdayOf(d.date)}</span>
          ))}
        </div>
      </SidebarSection>
    </>
  );
}
