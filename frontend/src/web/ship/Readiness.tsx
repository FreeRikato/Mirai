import { cn } from "cn";
import { RotateCw } from "lucide-react";
import type { MergeMove, ReadinessItem, ShipQueue } from "@/shared/ship";
import { navigate, shipHref } from "../router";
import { repoName } from "../tasks/github/meta";
import { ScoreBar, since } from "../tasks/ui/Layout";
import { useReadiness, useRefreshReadiness } from "./api";
import type { Tone } from "./derive";
import { useShipUi } from "./store";
import { toneText } from "./tone";

const MOVE_TONE: Record<MergeMove, Tone> = {
  merge: "ok",
  "fix ci": "bad",
  "address review": "bad",
  rebase: "warn",
  "nudge reviewer": "warn",
  "finish draft": "link",
  split: "link",
  close: "dim",
};

export function Readiness({ queue }: { queue: ShipQueue }) {
  const { data } = useReadiness();
  const refresh = useRefreshReadiness();
  const ready = data?.kind === "ready" ? data : null;

  return (
    <section aria-label="merge readiness" className="flex flex-col pb-3">
      <div className="flex items-center justify-between gap-2 px-5 pt-4 pb-2">
        <h2 className="m-0 shrink-0 text-[12px] font-semibold whitespace-nowrap">merge readiness</h2>
        <span className="flex min-w-0 items-center gap-2 text-[9px] whitespace-nowrap text-dim">
          {refresh.isPending ? <span>ranking</span> : ready && <span className="truncate">{since(ready.rankedAt)} · {ready.items.length + ready.more} ranked</span>}
          <button type="button" aria-label="rank merge readiness again" disabled={refresh.isPending} onClick={() => refresh.mutate()} className="shrink-0 cursor-pointer border-0 bg-transparent p-0 text-fg hover:text-dim disabled:opacity-40">
            <RotateCw aria-hidden className="size-3" />
          </button>
        </span>
      </div>
      {data?.kind === "unranked" && !refresh.isPending && <p className="m-0 px-5 text-[10px] text-dim">press ↻ to rank your pull requests</p>}
      {data?.kind === "unavailable" && <p className="m-0 px-5 text-[10px] break-words text-dim">{data.reason}</p>}
      {ready?.items.map((item, i) => <ReadinessRow key={item.id} item={item} rank={i + 1} queue={queue} />)}
      {ready && (ready.more > 0 || ready.unranked > 0) && (
        <span className="flex gap-3 px-5 pt-2.5 text-[10px] text-dim">
          {ready.more > 0 && <span>+ {ready.more} lower</span>}
          {ready.unranked > 0 && <span>+ {ready.unranked} unranked</span>}
        </span>
      )}
    </section>
  );
}

function ReadinessRow({ item, rank, queue }: { item: ReadinessItem; rank: number; queue: ShipQueue }) {
  const open = useShipUi(s => s.selected === item.id);
  const select = useShipUi(s => s.select);
  const reveal = useShipUi(s => s.reveal);

  return (
    <button
      type="button"
      aria-pressed={open}
      onClick={() => {
        if (open) return select(null);
        reveal(item.id, item.repo);
        if (queue !== "mine") navigate(shipHref("mine"));
      }}
      className={cn(
        "grid cursor-pointer grid-cols-[14px_1fr] gap-x-2 border-0 border-b border-l-2 border-b-rule bg-transparent py-2.5 pr-5 pl-[18px] text-left font-mono text-fg hover:bg-raise",
        open ? "border-l-fg bg-raise" : "border-l-transparent",
      )}
    >
      <span className="text-[10px] text-faint">{rank}</span>
      <span className="flex min-w-0 flex-col gap-1.5">
        <span className="line-clamp-2 text-[11px] leading-[1.5] break-words">{item.title}</span>
        <span className="flex min-w-0 items-center gap-2 text-[9px] whitespace-nowrap text-dim">
          <ScoreBar score={item.score} label="merge readiness" />
          <span className={toneText[MOVE_TONE[item.move]]}>{item.move}</span>
          <span className="truncate">
            {repoName(item.repo)}#{item.number}
          </span>
        </span>
        {open && (
          <span aria-label="why" className="flex flex-col text-[9px] leading-[1.6] break-words text-dim">
            {item.evidence.map(line => (
              <span key={line}>· {line}</span>
            ))}
          </span>
        )}
      </span>
    </button>
  );
}
