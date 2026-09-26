import { cn } from "cn";
import { Fragment } from "react";
import { HoverTip, useHoverTip } from "./HoverTip";
import { PROVIDERS, type Metric, type Money, type SeriesPoint, type UsageReport } from "@/shared/usage";
import { percent, share, ticks, tokens, usd } from "./derive";
import { PROVIDER_COLOR, PROVIDER_LABEL, useMachineColors } from "./providers";
import { MiraiSpend } from "./MiraiSpend";

const valueOf = (m: Money, metric: Metric) => (metric === "cost" ? m.costUsd : m.tokens);
const show = (n: number, metric: Metric) => (metric === "cost" ? usd(n) : tokens(n));

const dayLabel = (t: number) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "2-digit" }).toLowerCase();
const hourLabel = (t: number) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });

function Summary({ report, metric }: { report: UsageReport; metric: Metric }) {
  const color = useMachineColors();
  const total = valueOf(report.totals, metric);
  const maxMachine = Math.max(0, ...report.machines.map(m => valueOf(m, metric)));
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-col gap-1">
        <span className="text-[34px] leading-none font-semibold tracking-[-0.02em]">{show(total, metric)}</span>
        <span className="text-[10px] text-dim">
          {report.totals.sessions} sessions{metric === "cost" ? " · api estimate" : ""} · {report.period}
        </span>
      </div>
      <div className="flex flex-col gap-2.5">
        {report.providers.map(p => (
          <div key={p.provider} className="flex flex-col gap-0.5">
            <div className="flex items-center gap-2 text-[11px]">
              <span aria-hidden className="size-2 shrink-0" style={{ background: PROVIDER_COLOR[p.provider] }} />
              {PROVIDER_LABEL[p.provider]}
              <span className="ml-auto font-semibold">{show(valueOf(p, metric), metric)}</span>
            </div>
            <span className="text-[10px] text-dim">
              {percent(share(valueOf(p, metric), total))} of {metric} · {metric === "cost" ? `${tokens(p.tokens)} tokens` : usd(p.costUsd)}
            </span>
          </div>
        ))}
        <MiraiSpend period={report.period} at={report.at} />
      </div>
      <div className="flex flex-col gap-2 border-t border-rule pt-2.5">
        {report.machines.map(m => (
          <div key={m.name} className="flex items-center gap-2 text-[10px]">
            <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ background: color(m.name) }} />
            <span className="w-20 shrink-0 truncate">{m.name}</span>
            <span className="h-1 min-w-0 flex-1 bg-track">
              <span className="block h-full" style={{ width: `${share(valueOf(m, metric), maxMachine) * 100}%`, background: color(m.name) }} />
            </span>
            <span className="w-16 shrink-0 text-right text-dim">{show(valueOf(m, metric), metric)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Chart({ report, metric }: { report: UsageReport; metric: Metric }) {
  const points = report.series;
  const hourly = report.resolution === "hour";
  const label = (p: SeriesPoint) => (hourly ? hourLabel(p.start) : dayLabel(p.start));
  const totalOf = (p: SeriesPoint) => PROVIDERS.reduce((n, pr) => n + valueOf(p[pr], metric), 0);
  const max = Math.max(0, ...points.map(totalOf));
  const peakIndex = points.findIndex(p => totalOf(p) === max);
  const peak = points[peakIndex];
  const marks = new Set(ticks(points.length, 6));
  const { tip, show: showTip, hide } = useHoverTip<number>();
  const hovered = tip ? points[tip.value] : undefined;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="m-0 text-[12px] font-semibold">
          {hourly ? "hourly" : "daily"} {metric === "cost" ? "cost" : "tokens"}
        </h2>
        <span className="flex items-center gap-3.5 text-[10px] text-dim">
          {PROVIDERS.map(p => (
            <span key={p} className="flex items-center gap-1.5">
              <span aria-hidden className="size-2" style={{ background: PROVIDER_COLOR[p] }} />
              {p}
            </span>
          ))}
          {peak && max > 0 && (
            <span>
              peak {show(max, metric)} · {label(peak)}
            </span>
          )}
        </span>
      </div>
      {max === 0 ? (
        <p className="m-0 flex h-[200px] items-center justify-center border-b border-rule text-[11px] text-dim">no activity in this window</p>
      ) : (
        <div
          role="img"
          aria-label={`${hourly ? "hourly" : "daily"} ${metric} chart`}
          onMouseLeave={hide}
          className={cn("flex h-[200px] items-end border-b border-rule", points.length > 40 ? "gap-px" : "gap-1.5")}
        >
          {points.map((p, i) => {
            const last = i === points.length - 1;
            return (
              <div
                key={p.start}
                onMouseEnter={e => showTip(e.currentTarget.lastElementChild ?? e.currentTarget, i)}
                className={cn("flex h-full min-w-0 flex-1 flex-col justify-end", tip?.value === i && "bg-lift")}
              >
                <div className={cn("flex flex-col-reverse", last && "opacity-50")} style={{ height: `${(totalOf(p) / max) * 100}%` }}>
                  {PROVIDERS.map(pr => (
                    <div key={pr} style={{ height: `${share(valueOf(p[pr], metric), totalOf(p)) * 100}%`, background: PROVIDER_COLOR[pr], opacity: pr === "codex" ? 0.85 : 1 }} />
                  ))}
                </div>
              </div>
            );
          })}
          {tip && hovered && (
            <HoverTip anchor={tip.anchor}>
              <div className="mb-1.5 font-semibold">{tip.value === points.length - 1 ? (hourly ? "now" : "today") : label(hovered)}</div>
              <div className="grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5">
                {PROVIDERS.map(pr => (
                  <Fragment key={pr}>
                    <span className="flex items-center gap-1.5 text-dim">
                      <span aria-hidden className="size-2" style={{ background: PROVIDER_COLOR[pr] }} />
                      {pr}
                    </span>
                    <span className="text-right">{show(valueOf(hovered[pr], metric), metric)}</span>
                  </Fragment>
                ))}
                <span className="text-dim">total</span>
                <span className="text-right font-semibold">{show(totalOf(hovered), metric)}</span>
              </div>
            </HoverTip>
          )}
        </div>
      )}
      <div aria-hidden className={cn("flex text-[9px] text-dim", points.length > 40 ? "gap-px" : "gap-1.5")}>
        {points.map((p, i) => (
          <span key={p.start} className="relative h-3 min-w-0 flex-1">
            {marks.has(i) && <span className={cn("absolute top-0 whitespace-nowrap", i === points.length - 1 ? "right-0" : "left-0")}>{i === points.length - 1 ? (hourly ? "now" : "today") : label(p)}</span>}
          </span>
        ))}
      </div>
    </div>
  );
}

export function Spend({ report, metric }: { report: UsageReport; metric: Metric }) {
  return (
    <section aria-label="spend" className="grid gap-8 md:grid-cols-[300px_minmax(0,1fr)] md:gap-12">
      <Summary report={report} metric={metric} />
      <Chart report={report} metric={metric} />
    </section>
  );
}

export function Totals({ report }: { report: UsageReport }) {
  const t = report.totals;
  const cells = [
    ["processed tokens", tokens(t.tokens)],
    ["cached input", tokens(t.cached)],
    ["uncached input", tokens(t.uncached)],
    ["output", tokens(t.output)],
    ["cache savings", usd(t.cacheSavingsUsd)],
    ["avg / session", usd(t.sessions ? t.costUsd / t.sessions : 0)],
  ] as const;
  return (
    <section aria-label="totals" className="grid grid-cols-2 gap-x-6 gap-y-4 border-y border-rule py-3.5 md:grid-cols-6">
      {cells.map(([k, v]) => (
        <div key={k} className="flex flex-col gap-1">
          <span className="text-[10px] text-dim">{k}</span>
          <span className="text-[16px] font-semibold">{v}</span>
        </div>
      ))}
    </section>
  );
}
