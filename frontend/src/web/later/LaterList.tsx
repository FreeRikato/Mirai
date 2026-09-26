import { cn } from "cn";
import { Circle, CircleCheck, CircleDashed, ShieldOff } from "lucide-react";
import { verdictLabel, type LaterItem, type LaterKind, type Verdict } from "@/shared/later";
import { ago } from "../format";
import { useReveal } from "../hooks";
import { Unavailable } from "../tasks/ui/Layout";
import { isStale, lengthLabel } from "./derive";
import { DropLine, useDragOrder, type Place } from "./dragOrder";

const VERDICT_TONE: Record<Verdict, string> = { full: "text-ok", skim: "text-warn", summary: "text-dim", archive: "text-dim" };

function Status({ item }: { item: LaterItem }) {
  if (item.state === "done") return <CircleCheck aria-label="done" className="size-3 shrink-0 text-ok" />;
  if (item.progress > 0) return <CircleDashed aria-label="in progress" className="size-3 shrink-0 text-fg" />;
  return <Circle aria-label="unread" className="size-3 shrink-0 text-dim" />;
}

function ProgressBar({ item, className }: { item: LaterItem; className?: string }) {
  if (item.progress <= 0 || item.progress >= 1) return null;
  return (
    <span aria-label={`${Math.round(item.progress * 100)}% through`} className={cn("block h-[3px] bg-track", className)}>
      <span className="block h-full bg-fg" style={{ width: `${Math.round(item.progress * 100)}%` }} />
    </span>
  );
}

function Meta({ item }: { item: LaterItem }) {
  const external = item.embed.type === "external";
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-dim">
      <span className="truncate">{item.site}</span>
      {lengthLabel(item) && <span>· {lengthLabel(item)}</span>}
      {item.progress > 0 && item.progress < 1 && item.kind === "read" && (
        <>
          <ProgressBar item={item} className="w-12" />
          <span>{Math.round(item.progress * 100)}%</span>
        </>
      )}
      {item.progress > 0 && item.progress < 1 && item.kind === "watch" && <span className="text-fg">· resume</span>}
      {external && (
        <span className="flex items-center gap-1 text-warn">
          · <ShieldOff aria-hidden className="size-2.5" /> external
        </span>
      )}
      {item.worth !== "unscored" && <span className={VERDICT_TONE[item.worth]}>· {verdictLabel(item.worth, item.kind)}</span>}
    </span>
  );
}

function ReadRow({ item }: { item: LaterItem }) {
  return (
    <>
      <span className="flex items-start gap-2.5">
        <span className="pt-0.5">
          <Status item={item} />
        </span>
        <span className={cn("min-w-0 flex-1 text-[12px] leading-snug", item.state === "done" ? "text-dim" : "text-fg")}>{item.title}</span>
      </span>
      <span className="pl-[22px]">
        <Meta item={item} />
      </span>
      {item.tldr[0] && <span className="line-clamp-2 pl-[22px] font-serif text-[12.5px] leading-snug text-dim">{item.tldr[0]}</span>}
    </>
  );
}

function WatchRow({ item }: { item: LaterItem }) {
  return (
    <span className="flex gap-3.5">
      <span className="relative h-[63px] w-28 shrink-0 overflow-hidden bg-track">
        {item.image && <img data-no-lightbox src={item.image} alt="" className="h-full w-full object-cover" />}
        {item.lengthSec !== null && <span className="absolute right-1 bottom-1 bg-[#000000cc] px-1 text-[9px] text-fg">{lengthLabel(item)}</span>}
        {item.progress > 0 && (
          <span className="absolute inset-x-0 bottom-0 h-[3px] bg-[#ffffff33]">
            <span className={cn("block h-full", item.progress >= 1 ? "bg-ok" : "bg-bad")} style={{ width: `${Math.round(item.progress * 100)}%` }} />
          </span>
        )}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className={cn("line-clamp-2 text-[12px] leading-snug", item.state === "done" ? "text-dim" : "text-fg")}>{item.title}</span>
        <Meta item={item} />
      </span>
    </span>
  );
}

export function LaterList({ items, kind, selected, staleDays, loading, onSelect, onPlace }: { items: readonly LaterItem[]; kind: LaterKind; selected: string | null; staleDays: number; loading: boolean; onSelect: (id: string) => void; onPlace?: Place }) {
  const { shown, footer } = useReveal(items.length, `${kind}:${items.length}`);
  const { rowProps, lineAt, dragging } = useDragOrder(onPlace);
  if (loading) return <Unavailable reason="loading" />;
  if (items.length === 0) return <Unavailable reason={`nothing to ${kind} here. paste a link above to save one`} />;
  const now = Date.now();
  return (
    <div role="list" aria-label={`${kind} later`} className="flex min-w-0 flex-1 flex-col overflow-y-auto">
      {items.slice(0, shown).map(item => {
        const on = item.id === selected;
        const stale = isStale(item, now, staleDays);
        return (
          <button
            key={item.id}
            type="button"
            role="listitem"
            data-later={item.id}
            aria-current={on || undefined}
            onClick={() => onSelect(item.id)}
            {...rowProps(item.id)}
            className={cn(
              "relative flex w-full cursor-pointer flex-col gap-1.5 border-0 border-b border-rule bg-transparent px-5 py-3 text-left font-mono",
              on ? "bg-raise shadow-[inset_2px_0_0_var(--color-fg)]" : "hover:bg-hover",
              stale && !on && "opacity-50",
              dragging === item.id && "opacity-30",
            )}
          >
            <DropLine side={lineAt(item.id)} />
            <span className={cn("absolute top-3 right-4 text-[10px]", stale ? "text-warn" : "text-dim")}>{ago(item.savedAt, now)}</span>
            <span className="pr-8">{kind === "watch" ? <WatchRow item={item} /> : <ReadRow item={item} />}</span>
          </button>
        );
      })}
      {footer}
    </div>
  );
}
