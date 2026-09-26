import { cn } from "cn";
import { RefreshCw } from "lucide-react";
import { METRICS, PERIODS, type Metric, type Period } from "@/shared/usage";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ago } from "../format";
import { useAiUsage, useRefreshAi } from "./api";
import { Heatmaps } from "./Heatmaps";
import { Limits } from "./Limits";
import { Models } from "./Models";
import { Spend, Totals } from "./Spend";
import { useMachineColors } from "./providers";
import { useStatsUi } from "./store";

const SECTIONS = ["ai usage", "health", "finance", "productivity"] as const;

function Segmented<V extends string>({ label, value, options, onChange }: { label: string; value: V; options: readonly V[]; onChange: (v: V) => void }) {
  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={v => {
        const hit = options.find(o => o === v);
        if (hit) onChange(hit);
      }}
      aria-label={label}
      className="border border-rule"
    >
      {options.map(o => (
        <ToggleGroupItem key={o} value={o} className="h-6 cursor-pointer px-2.5 font-mono text-[10px] text-dim hover:text-fg data-[state=on]:bg-lift data-[state=on]:text-fg">
          {o}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

export function StatsView() {
  const ui = useStatsUi();
  const color = useMachineColors();
  const { data: report, isPending, isError, isFetching } = useAiUsage(ui.period, ui.hidden);
  const names = report?.known ?? [];
  const refresh = useRefreshAi();
  const synced = report ? Math.min(...report.machines.map(m => m.syncedAt ?? report.at)) : null;

  return (
    <div className="flex min-w-0 flex-1 flex-col pb-[env(safe-area-inset-bottom)]">
      <div className="flex min-h-11 shrink-0 flex-wrap items-center justify-between gap-x-5 gap-y-2 border-b border-rule px-4 py-2 md:flex-nowrap md:px-6 md:py-0">
        <nav aria-label="stats sections" className="flex h-8 items-center gap-5 overflow-x-auto md:h-11">
          {SECTIONS.map(s =>
            s === "ai usage" ? (
              <span key={s} aria-current="page" className="flex h-full items-center border-b border-fg text-[11px] whitespace-nowrap text-fg">
                {s}
              </span>
            ) : (
              <span key={s} aria-disabled title="coming soon" className="text-[11px] whitespace-nowrap text-dim">
                {s}
              </span>
            ),
          )}
        </nav>
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2">
          <Segmented<Metric> label="metric" value={ui.metric} options={METRICS} onChange={ui.setMetric} />
          <Segmented<Period> label="period" value={ui.period} options={PERIODS} onChange={ui.setPeriod} />
          <div role="group" aria-label="machines" className="flex h-6 items-center gap-2.5 border border-rule px-2.5">
            {names.map(n => {
              const on = !ui.hidden.includes(n);
              return (
                <button key={n} type="button" aria-pressed={on} onClick={() => ui.toggleMachine(n)} className={cn("flex cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 font-mono text-[10px]", on ? "text-fg" : "text-dim line-through hover:text-soft")}>
                  <span aria-hidden className="size-1.5 rounded-full" style={{ background: on ? color(n) : "var(--color-faint)" }} />
                  {n}
                </button>
              );
            })}
          </div>
          <span className="text-[10px] whitespace-nowrap text-dim">{refresh.isPending ? "syncing" : synced ? `synced ${ago(synced) === "now" ? "just now" : `${ago(synced)} ago`}` : ""}</span>
          <button type="button" aria-label="refresh usage" disabled={refresh.isPending} onClick={() => refresh.mutate()} className="-m-1 flex cursor-pointer border-0 bg-transparent p-1 text-dim hover:text-fg disabled:cursor-default disabled:opacity-40">
            <RefreshCw aria-hidden className="size-3" />
          </button>
        </div>
      </div>
      <main className={cn("@container min-h-0 flex-1 overflow-y-auto", isFetching && !isPending && "opacity-80")}>
        {isPending ? (
          <p className="m-0 p-4 text-[11px] text-dim md:p-6">reading usage from the machines</p>
        ) : isError || !report ? (
          <p className="m-0 p-4 text-[11px] text-dim md:p-6">the hub could not build the usage report</p>
        ) : (
          <div className="flex flex-col gap-[30px] px-4 pt-5 pb-8 md:px-6">
            <Limits limits={report.limits} now={report.at} />
            <Spend report={report} metric={ui.metric} />
            <Totals report={report} />
            <Models report={report} metric={ui.metric} />
            <Heatmaps report={report} />
          </div>
        )}
      </main>
    </div>
  );
}
