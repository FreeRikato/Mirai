import { cn } from "cn";
import type { Metric, UsageReport } from "@/shared/usage";
import { percent, share, tokens, usd } from "./derive";
import { PROVIDER_COLOR } from "./providers";

const cell = "px-0 py-2 font-mono text-[11px]";
const head = "px-0 py-1.5 font-mono text-[10px] font-normal text-dim";

export function Models({ report, metric }: { report: UsageReport; metric: Metric }) {
  const total = metric === "cost" ? report.totals.costUsd : report.totals.tokens;
  const models = metric === "cost" ? report.models : report.models.toSorted((a, b) => b.tokens - a.tokens);
  const top = Math.max(0, ...models.map(m => share(metric === "cost" ? m.costUsd : m.tokens, total)));
  return (
    <section aria-label="models">
      <table className="w-full table-fixed border-collapse">
        <colgroup>
          <col />
          <col className="hidden w-[200px] @3xl:table-column" />
          <col className="hidden w-[90px] @xl:table-column" />
          <col className="w-[76px] @xl:w-[100px]" />
          <col className="w-[110px] @xl:w-[170px]" />
          <col className="w-[84px] @xl:w-[100px]" />
        </colgroup>
        <thead>
          <tr className="border-b border-rule text-left">
            <th className={head}>model</th>
            <th className={cn(head, "hidden @3xl:table-cell")}>machines</th>
            <th className={cn(head, "hidden text-right @xl:table-cell")}>sessions</th>
            <th className={cn(head, "text-right")}>tokens</th>
            <th className={cn(head, "text-right")}>share</th>
            <th className={cn(head, "text-right")}>cost</th>
          </tr>
        </thead>
        <tbody>
          {models.length === 0 ? (
            <tr>
              <td colSpan={6} className={cn(cell, "py-6 text-center text-dim")}>
                no activity in this window
              </td>
            </tr>
          ) : (
            models.map(m => {
              const s = share(metric === "cost" ? m.costUsd : m.tokens, total);
              return (
                <tr key={`${m.provider}:${m.model}`} className="border-b border-rule hover:bg-hover">
                  <td className={cell}>
                    <span className="flex min-w-0 items-center gap-2">
                      <span aria-hidden className="size-1.5 shrink-0" style={{ background: PROVIDER_COLOR[m.provider] }} />
                      <span className="truncate">{m.model}</span>
                    </span>
                  </td>
                  <td className={cn(cell, "hidden truncate text-dim @3xl:table-cell")}>{m.machines.join(" · ")}</td>
                  <td className={cn(cell, "hidden text-right text-dim @xl:table-cell")}>{m.sessions}</td>
                  <td className={cn(cell, "text-right")}>{tokens(m.tokens)}</td>
                  <td className={cell}>
                    <span className="flex items-center justify-end gap-2">
                      <span className="hidden h-1 w-[90px] bg-track @xl:block">
                        <span className="block h-full" style={{ width: `${share(s, top) * 100}%`, background: PROVIDER_COLOR[m.provider] }} />
                      </span>
                      <span className="w-8 text-right text-dim">{metric === "cost" && !m.priced ? "--" : percent(s)}</span>
                    </span>
                  </td>
                  <td className={cn(cell, "text-right", !m.priced && "text-dim")} title={m.priced ? undefined : "no price for this model in the LiteLLM table"}>
                    {m.priced ? usd(m.costUsd) : "unpriced"}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </section>
  );
}
