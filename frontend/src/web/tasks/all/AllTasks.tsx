import { cn } from "cn";
import { Layers } from "lucide-react";
import { TASK_SOURCES, type TaskSource } from "@/shared/tasks";
import { ago } from "../../format";
import { useSettings } from "../../settings";
import { useGithubTasks, useLinearTasks, useLocalTasks, useMoveGithub, useMoveLinear, useMoveLocal } from "../api";
import { owned } from "../derive";
import { GithubDrawer } from "../github/GithubDrawer";
import { GithubCard } from "../github/GithubTasks";
import { githubGlyph, who as githubWho } from "../github/meta";
import { LinearDrawer } from "../linear/LinearDrawer";
import { LinearCard } from "../linear/LinearTasks";
import { linearGlyph, who as linearWho } from "../linear/meta";
import { LocalDrawer, localGlyph } from "../local/LocalDrawer";
import { LocalCard } from "../local/LocalTasks";
import { useTasksUi, type AllRange } from "../store";
import type { Glyph } from "../ui/Glyph";
import { Kanban, type KanbanColumn } from "../ui/Kanban";
import { CountRow, FilterTabs, SidebarHeader, SidebarSection, SOURCE_ICON, TasksLayout, Unavailable } from "../ui/Layout";
import { columnOf, combine, inAllRange, keyOf, localDay, moveOf, type AllColumn, type AnyTask } from "./derive";

const COLUMNS: readonly KanbanColumn<AllColumn>[] = [
  { id: "open", label: "open", glyph: "open" },
  { id: "doing", label: "doing", glyph: "doing" },
  { id: "done", label: "done", glyph: "done" },
];

type SourceState = { kind: "pending" } | { kind: "unavailable"; reason: string } | { kind: "ready"; at: number };

function glyphOf(t: AnyTask): Glyph {
  switch (t.source) {
    case "local":
      return localGlyph[t.task.state];
    case "linear":
      return linearGlyph[t.task.column];
    case "github":
      return githubGlyph[t.task.column];
  }
}

export function AllTasks() {
  const local = useLocalTasks().data;
  const linear = useLinearTasks().data;
  const github = useGithubTasks().data;
  const { staleAfterMs, linearGithubBot } = useSettings().tasks;
  const moveLocal = useMoveLocal();
  const moveLinear = useMoveLinear();
  const moveGithub = useMoveGithub();
  const range = useTasksUi(s => s.allRange);
  const setRange = useTasksUi(s => s.setAllRange);
  const linearOwner = useTasksUi(s => s.linearOwner);
  const githubOwner = useTasksUi(s => s.githubOwner);
  const selectedRef = useTasksUi(s => s.allSelected);
  const selectAll = useTasksUi(s => s.selectAll);

  if (!local && !linear && !github) return <TasksLayout board="all" sidebar={null}><Unavailable reason="gathering tasks" /></TasksLayout>;

  const localReady = local?.kind === "ready" ? local : null;
  const linearIssues = linear?.kind === "ready" ? linear.issues : [];
  const githubIssues = github?.kind === "ready" ? github.issues : [];
  const hideMirrorsOf = linear?.kind === "ready" ? linearGithubBot : null;
  const every = combine({ local: localReady?.tasks ?? [], linear: linearIssues, github: githubIssues }, hideMirrorsOf);
  const today = localReady?.today ?? localDay(new Date().toISOString());
  const shown = combine(
    {
      local: localReady?.tasks ?? [],
      linear: owned(linearIssues, linearOwner, linearWho),
      github: owned(githubIssues, githubOwner, githubWho),
    },
    hideMirrorsOf,
  ).filter(t => inAllRange(t, range, today));
  const selected = selectedRef ? (every.find(t => t.source === selectedRef.source && t.task.id === selectedRef.id) ?? null) : null;
  const error = moveLocal.error ?? moveLinear.error ?? moveGithub.error;

  const states: Record<TaskSource, SourceState> = {
    local: !local ? { kind: "pending" } : local.kind === "ready" ? { kind: "ready", at: local.changedAt } : local,
    linear: !linear ? { kind: "pending" } : linear.kind === "ready" ? { kind: "ready", at: linear.fetchedAt } : linear,
    github: !github ? { kind: "pending" } : github.kind === "ready" ? { kind: "ready", at: github.fetchedAt } : github,
  };

  const move = (t: AnyTask, to: AllColumn) => {
    const m = moveOf(t, to);
    if (m?.source === "local") moveLocal.mutate(m.move);
    else if (m?.source === "linear") moveLinear.mutate(m.move);
    else if (m?.source === "github") moveGithub.mutate(m.move);
  };

  const renderCard = (t: AnyTask) => {
    const badge = <SourceBadge source={t.source} />;
    switch (t.source) {
      case "local":
        return <LocalCard task={t.task} today={localReady?.today ?? t.task.date} badge={badge} />;
      case "linear":
        return <LinearCard issue={t.task} badge={badge} />;
      case "github":
        return <GithubCard issue={t.task} badge={badge} />;
    }
  };

  return (
    <TasksLayout
      board="all"
      sidebar={<AllSidebar tasks={shown} states={states} />}
      filters={
        <FilterTabs<AllRange>
          label="range"
          value={range}
          onChange={setRange}
          options={[
            { value: "today", label: "today" },
            { value: "week", label: "this week" },
            { value: "all", label: "all" },
          ]}
        />
      }
      status={error ? <span className="text-bad">{error.message}</span> : <SyncStates states={states} staleAfterMs={staleAfterMs} />}
      drawer={selected && <AnyDrawer task={selected} onClose={() => selectAll(null)} />}
    >
      <Kanban
        label="all tasks"
        columns={COLUMNS}
        items={shown}
        keyOf={keyOf}
        columnOf={columnOf}
        glyphOf={glyphOf}
        renderCard={renderCard}
        onMove={move}
        canDrop={(t, to) => moveOf(t, to) !== null}
        selected={selected && keyOf(selected)}
        onSelect={key => {
          const hit = shown.find(t => keyOf(t) === key);
          if (hit) selectAll({ source: hit.source, id: hit.task.id });
        }}
      />
    </TasksLayout>
  );
}

function SourceBadge({ source }: { source: TaskSource }) {
  const Icon = SOURCE_ICON[source];
  return <Icon aria-label={source} className="size-2.5 shrink-0 text-dim" />;
}

function AnyDrawer({ task: t, onClose }: { task: AnyTask; onClose: () => void }) {
  switch (t.source) {
    case "local":
      return <LocalDrawer task={t.task} onClose={onClose} />;
    case "linear":
      return <LinearDrawer issue={t.task} onClose={onClose} />;
    case "github":
      return <GithubDrawer issue={t.task} onClose={onClose} />;
  }
}

function SyncStates({ states, staleAfterMs }: { states: Record<TaskSource, SourceState>; staleAfterMs: number }) {
  const now = Date.now();
  return TASK_SOURCES.map(s => {
    const Icon = SOURCE_ICON[s];
    const st = states[s];
    return (
      <span key={s} data-sync={s} title={st.kind === "unavailable" ? st.reason : undefined} className="flex items-center gap-1">
        <Icon aria-label={s} className="size-2.5" />
        {st.kind === "pending" ? (
          <span>…</span>
        ) : st.kind === "unavailable" ? (
          <span className="text-bad">down</span>
        ) : (
          <span className={cn(s !== "local" && now - st.at > staleAfterMs && "text-warn")}>{ago(st.at, now)}</span>
        )}
      </span>
    );
  });
}

function AllSidebar({ tasks, states }: { tasks: readonly AnyTask[]; states: Record<TaskSource, SourceState> }) {
  return (
    <>
      <SidebarHeader icon={Layers} title="All" />
      <SidebarSection title="sources" right="not done">
        {TASK_SOURCES.map(s => {
          const Icon = SOURCE_ICON[s];
          const st = states[s];
          return (
            <CountRow
              key={s}
              icon={<Icon aria-hidden className="size-3" />}
              label={st.kind === "unavailable" ? <span className="truncate text-bad" title={st.reason}>{s} unavailable</span> : s}
              count={tasks.filter(t => t.source === s && columnOf(t) !== "done").length}
            />
          );
        })}
      </SidebarSection>
    </>
  );
}
