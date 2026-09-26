import { cn } from "cn";
import { RotateCw } from "lucide-react";
import type { PriorityItem, PriorityReason, TaskBoard, TaskSource } from "@/shared/tasks";
import { imageEmbeds } from "@/shared/wikilinks";
import { useGithubTasks, useLinearTasks, useLocalTasks, usePriority, useRefreshPriority } from "../api";
import { GithubDrawer } from "../github/GithubDrawer";
import { LinearDrawer } from "../linear/LinearDrawer";
import { LocalDrawer } from "../local/LocalDrawer";
import { shortDay } from "../local/derive";
import { useTasksUi } from "../store";
import { ScoreBar, since, SOURCE_ICON } from "../ui/Layout";

/*
 * What to work on next across daily notes, Linear and GitHub, ranked by Jev, at the foot of every board's sidebar.
 * Ranking happens only when ↻ is pressed; between presses finished items drop out and the rest keep their order.
 * A pick from the board on screen selects its card as usual; a pick from another source opens that card's drawer
 * in place (a peek), so the board never changes under you.
 */

const REASON_TONE: Record<PriorityReason, string> = {
  customer: "text-bad",
  "in flight": "text-warn",
  "ai core": "text-link",
  unblocks: "text-ok",
  hygiene: "text-dim",
};

export function Priority({ board }: { board: TaskBoard }) {
  const { data } = usePriority();
  const refresh = useRefreshPriority();
  const ready = data?.kind === "ready" ? data : null;

  return (
    <section aria-label="priority" className="flex flex-col pb-3">
      <div className="flex items-center justify-between px-5 pt-4 pb-2">
        <h2 className="m-0 text-[12px] font-semibold">priority</h2>
        <span className="flex items-center gap-2 text-[9px] text-dim">
          {refresh.isPending ? <span>ranking</span> : ready && <span>{since(ready.rankedAt)} · {ready.items.length + ready.more} ranked</span>}
          <button type="button" aria-label="rank again" disabled={refresh.isPending} onClick={() => refresh.mutate()} className="cursor-pointer border-0 bg-transparent p-0 text-fg hover:text-dim disabled:opacity-40">
            <RotateCw aria-hidden className="size-3" />
          </button>
        </span>
      </div>
      {data?.kind === "unranked" && !refresh.isPending && <p className="m-0 px-5 text-[10px] text-dim">press ↻ to rank</p>}
      {data?.kind === "unavailable" && <p className="m-0 px-5 text-[10px] break-words text-dim">{data.reason}</p>}
      {ready?.items.map((item, i) => <PriorityRow key={`${item.source}:${item.id}`} item={item} rank={i + 1} board={board} />)}
      {ready && ready.more > 0 && <span className="px-5 pt-2.5 text-[10px] text-dim">+ {ready.more} lower</span>}
    </section>
  );
}

function PriorityRow({ item, rank, board }: { item: PriorityItem; rank: number; board: TaskBoard }) {
  const select = useTasksUi(s => s.select);
  const selectAll = useTasksUi(s => s.selectAll);
  const peek = useTasksUi(s => s.peek);
  const setPeek = useTasksUi(s => s.setPeek);
  const onBoard = item.source === board;
  const open = useTasksUi(s =>
    board === "all" ? s.allSelected?.source === item.source && s.allSelected.id === item.id : onBoard ? s.selected[item.source] === item.id : s.peek?.source === item.source && s.peek.id === item.id,
  );
  const Icon = SOURCE_ICON[item.source];

  return (
    <button
      type="button"
      aria-pressed={open}
      onClick={() => {
        const ref = open ? null : { source: item.source, id: item.id };
        if (board === "all") selectAll(ref);
        else if (onBoard) select(item.source, ref?.id ?? null);
        else setPeek(ref);
      }}
      className={cn(
        "grid cursor-pointer grid-cols-[14px_1fr] gap-x-2 border-0 border-b border-l-2 border-b-rule bg-transparent py-2.5 pr-5 pl-[18px] text-left font-mono text-fg hover:bg-raise",
        open ? "border-l-fg bg-raise" : "border-l-transparent",
        peek && !open && "opacity-80",
      )}
    >
      <span className="text-[10px] text-faint">{rank}</span>
      <span className="flex min-w-0 flex-col gap-1.5">
        <span className="line-clamp-2 text-[11px] leading-[1.5] break-words">{imageEmbeds(item.title).text}</span>
        <span className="flex items-center gap-2 text-[9px] text-dim">
          <ScoreBar score={item.score} label="return on investment" />
          <span className={REASON_TONE[item.reason]}>{item.reason}</span>
          <span className="flex min-w-0 items-center gap-1">
            <Icon aria-hidden className="size-2.5 shrink-0" />
            <span className="truncate">{item.source === "local" ? shortDay(item.ref) : item.ref}</span>
          </span>
        </span>
      </span>
    </button>
  );
}

/* The drawer of a card from another source, read from that source's own (shared, cached) query. */
export function PeekDrawer({ source, id }: { source: TaskSource; id: string }) {
  const close = () => useTasksUi.getState().setPeek(null);
  switch (source) {
    case "local":
      return <LocalPeek id={id} onClose={close} />;
    case "linear":
      return <LinearPeek id={id} onClose={close} />;
    case "github":
      return <GithubPeek id={id} onClose={close} />;
  }
}

function LocalPeek({ id, onClose }: { id: string; onClose: () => void }) {
  const { data } = useLocalTasks();
  const task = data?.kind === "ready" ? data.tasks.find(t => t.id === id) : undefined;
  return task ? <LocalDrawer task={task} onClose={onClose} /> : null;
}

function LinearPeek({ id, onClose }: { id: string; onClose: () => void }) {
  const { data } = useLinearTasks();
  const issue = data?.kind === "ready" ? data.issues.find(i => i.id === id) : undefined;
  return issue ? <LinearDrawer issue={issue} onClose={onClose} /> : null;
}

function GithubPeek({ id, onClose }: { id: string; onClose: () => void }) {
  const { data } = useGithubTasks();
  const issue = data?.kind === "ready" ? data.issues.find(i => i.id === id) : undefined;
  return issue ? <GithubDrawer issue={issue} onClose={onClose} /> : null;
}
