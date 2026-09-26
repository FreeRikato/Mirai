import type { Provider, UsageReport } from "@/shared/usage";
import { heatLevel, percent, tokens, usd, weekColumns } from "./derive";
import { HoverTip, useHoverTip } from "./HoverTip";
import { PROVIDER_COLOR, PROVIDER_LABEL } from "./providers";

const ROW_LABELS = ["m", "", "w", "", "f", "", "s"] as const;
const LEVELS = [0, 1, 2, 3, 4] as const;

const weekday = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }).toLowerCase();

const dayLabel = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "2-digit", timeZone: "UTC" }).toLowerCase();

const fill = (provider: Provider, level: number) => (level === 0 ? "var(--color-lift)" : PROVIDER_COLOR[provider]);

function Heatmap({ provider, days, values }: { provider: Provider; days: string[]; values: number[] }) {
  const cols = weekColumns(days, values);
  const max = Math.max(0, ...values);
  const today = days.at(-1);
  const { tip, show, hide } = useHoverTip<{ readonly day: string; readonly value: number }>();
  return (
    <div className="flex flex-col gap-2">
      <span className="flex items-center gap-2 text-[10px] text-dim">
        <span aria-hidden className="size-2" style={{ background: PROVIDER_COLOR[provider] }} />
        {PROVIDER_LABEL[provider].toLowerCase()} · {days.length}d tokens
      </span>
      <div role="img" aria-label={`${PROVIDER_LABEL[provider]} tokens per day, last ${days.length} days`} onMouseLeave={hide} className="flex gap-[3px]">
        <div aria-hidden className="flex flex-col gap-[3px]">
          {ROW_LABELS.map((l, i) => (
            <span key={i} className="flex size-4 items-center text-[9px] text-dim">
              {l}
            </span>
          ))}
        </div>
        {cols.map((col, c) => (
          <div key={c} className="flex flex-col gap-[3px]">
            {col.map((cell, r) => {
              if (!cell) return <span key={r} className="size-4" />;
              const level = heatLevel(cell.value, max);
              return (
                <span
                  key={r}
                  onMouseEnter={e => show(e.currentTarget, cell)}
                  className="size-4"
                  style={{
                    background: fill(provider, level),
                    opacity: level === 0 ? 1 : level / 4,
                    outline: cell.day === today || tip?.value.day === cell.day ? "1px solid var(--color-fg)" : undefined,
                    outlineOffset: -1,
                  }}
                />
              );
            })}
          </div>
        ))}
        {tip && (
          <HoverTip anchor={tip.anchor}>
            <div className="mb-1 font-semibold">
              {tip.value.day === today ? "today" : `${weekday(tip.value.day)} ${dayLabel(tip.value.day)}`}
            </div>
            <div className="text-dim">
              <span className="text-fg">{tokens(tip.value.value)}</span> tokens{max > 0 ? ` · ${percent(tip.value.value / max)} of peak` : ""}
            </div>
          </HoverTip>
        )}
      </div>
      <span aria-hidden className="flex items-center gap-1 text-[9px] text-dim">
        less
        {LEVELS.map(l => (
          <span key={l} className="size-2.5" style={{ background: fill(provider, l), opacity: l === 0 ? 1 : l / 4 }} />
        ))}
        more
      </span>
    </div>
  );
}

export function Heatmaps({ report }: { report: UsageReport }) {
  const h = report.habits;
  const hour = (n: number) => `${String(n).padStart(2, "0")}:00`;
  const rows = [
    ["active days", `${h.activeDays} / ${h.days}`, "either agent"],
    ["longest streak", `${h.longestStreak.days} ${h.longestStreak.days === 1 ? "day" : "days"}`, h.longestStreak.from && h.longestStreak.to ? `${dayLabel(h.longestStreak.from)} to ${dayLabel(h.longestStreak.to)}` : ""],
    ["busiest day", h.busiestWeekday?.day ?? "--", h.busiestWeekday ? `${usd(h.busiestWeekday.avgCostUsd)} avg` : ""],
    ["busiest hour", h.busiestHour ? `${hour(h.busiestHour.hour)} to ${hour((h.busiestHour.hour + 1) % 24)}` : "--", h.busiestHour ? `${percent(h.busiestHour.share)} of tokens` : ""],
    ["cache hit", percent(h.cacheHit), "of input tokens"],
  ] as const;
  return (
    <section aria-label="last 90 days" className="flex flex-col gap-8 lg:flex-row lg:gap-12">
      <div className="flex flex-col gap-8 overflow-x-auto sm:flex-row sm:gap-12">
        <Heatmap provider="claude" days={report.heatmap.days} values={report.heatmap.claude} />
        <Heatmap provider="codex" days={report.heatmap.days} values={report.heatmap.codex} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <h2 className="m-0 text-[12px] font-semibold">habits</h2>
        {rows.map(([k, v, sub]) => (
          <div key={k} className="flex items-center gap-3 border-b border-rule pb-2.5">
            <span className="w-[120px] shrink-0 text-[10px] text-dim">{k}</span>
            <span className="text-[12px] font-semibold">{v}</span>
            <span className="ml-auto truncate text-[10px] text-dim">{sub}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
