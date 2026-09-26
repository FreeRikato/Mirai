import type { Period } from "@/shared/usage";
import { useThreads } from "../mirai/api";
import { spentSince } from "../mirai/live";
import { usd } from "./derive";

const PERIOD_MS: Record<Period, number> = { "24h": 86_400_000, "7d": 7 * 86_400_000, "30d": 30 * 86_400_000, "90d": 90 * 86_400_000 };

export function MiraiSpend({ period, at }: { period: Period; at: number }) {
  const threads = useThreads(true);
  const since = at - PERIOD_MS[period];
  const recent = (threads.data ?? []).filter(t => t.spend.some(s => s.at >= since));
  if (recent.length === 0) return null;
  const cost = recent.reduce((sum, t) => sum + spentSince(t.spend, since), 0);
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-2 text-[11px]">
        <span aria-hidden className="size-2 shrink-0 bg-fg" />
        mirAI
        <span className="ml-auto font-semibold">{usd(cost)}</span>
      </div>
      <span className="text-[10px] text-dim">
        {recent.length} {recent.length === 1 ? "thread" : "threads"} · openai api, not in the total
      </span>
    </div>
  );
}
