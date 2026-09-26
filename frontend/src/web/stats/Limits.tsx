import { TrendingDown, TrendingUp, Minus } from "lucide-react";
import type { LimitWindow, Provider, ReportLimits } from "@/shared/usage";
import { ago } from "../format";
import { left, paceOf, resetsIn, timeLeft, type Pace } from "./derive";
import { PROVIDER_COLOR, PROVIDER_LABEL } from "./providers";

const LOW_LEFT = 30;

const PACE: Record<Pace, { icon: typeof TrendingUp; label: string; className: string }> = {
  ahead: { icon: TrendingUp, label: "ahead of pace: spending faster than the window elapses", className: "text-warn" },
  on: { icon: Minus, label: "on pace with the window", className: "text-dim" },
  under: { icon: TrendingDown, label: "under pace: headroom for the rest of the window", className: "text-dim" },
};

function WindowRow({ w, color, now }: { w: LimitWindow; color: string; now: number }) {
  const remaining = left(w);
  const low = remaining < LOW_LEFT;
  const t = timeLeft(w, now);
  const pace = paceOf(w, now);
  const reset = resetsIn(w, now);
  const P = pace ? PACE[pace] : null;
  const summary = `${w.label}: ${remaining}% left${t === null ? "" : `, ${Math.round(t * 100)}% of the window left`}${reset ? `, resets in ${reset}` : ""}`;
  return (
    <div className="grid grid-cols-[minmax(0,170px)_minmax(0,1fr)_78px] items-center gap-4 @3xl:grid-cols-[190px_minmax(0,1fr)_96px]">
      <span className="flex min-w-0 items-center justify-between gap-2 text-[11px]">
        <span className="truncate text-dim">{w.label}</span>
        <span className={low ? "font-semibold whitespace-nowrap text-bad" : "font-semibold whitespace-nowrap"}>{remaining}% left</span>
      </span>
      <div role="img" aria-label={summary} title={summary} className="relative h-4">
        <div className="absolute inset-x-0 top-[5px] h-1.5 bg-track" />
        <div className="absolute top-[5px] left-0 h-1.5" style={{ width: `${remaining}%`, background: low ? "var(--color-bad)" : color }} />
        {t !== null && <div aria-hidden className="absolute top-px h-3.5 w-px bg-fg/70" style={{ left: `${t * 100}%` }} />}
      </div>
      <span className="flex items-center justify-end gap-2 text-[10px] whitespace-nowrap text-dim">
        {P && <P.icon aria-label={P.label} className={`size-3 ${P.className}`} />}
        {reset ?? ""}
      </span>
    </div>
  );
}

function ProviderLimits({ provider, entries, now }: { provider: Provider; entries: ReportLimits[]; now: number }) {
  const color = PROVIDER_COLOR[provider];
  return (
    <section aria-label={`${PROVIDER_LABEL[provider]} limits`} className="flex min-w-0 flex-col gap-2.5">
      {entries.map((l, i) => (
        <div key={l.ok ? l.account : `err-${i}`} className="flex flex-col gap-2.5">
          <div className="flex items-center gap-2 border-b border-rule pb-1.5">
            <span aria-hidden className="size-2 shrink-0" style={{ background: color }} />
            <span className="text-[12px] font-semibold">{PROVIDER_LABEL[provider]}</span>
            {l.ok && l.plan && <span className="text-[10px] text-dim">{l.plan}</span>}
            <span className="ml-auto text-[10px] whitespace-nowrap text-dim">{l.ok ? `checked ${ago(l.checkedAt, now) === "now" ? "just now" : `${ago(l.checkedAt, now)} ago`} · ${l.source}` : l.source}</span>
          </div>
          {l.ok ? (
            <>
              {l.windows.map(w => (
                <WindowRow key={w.id} w={w} color={color} now={now} />
              ))}
              {l.resetCredits ? (
                <span className="pt-1 text-[10px] text-dim">
                  {l.resetCredits} reset {l.resetCredits === 1 ? "credit" : "credits"} banked
                </span>
              ) : null}
            </>
          ) : (
            <span className="text-[11px] text-dim">{l.error}</span>
          )}
        </div>
      ))}
    </section>
  );
}

export function Limits({ limits, now }: { limits: ReportLimits[]; now: number }) {
  const by = (p: Provider) => limits.filter(l => l.provider === p);
  return (
    <section aria-label="limits" className="flex flex-col gap-3.5">
      <h2 className="m-0 text-[12px] font-semibold">limits</h2>
      <div className="grid gap-8 md:grid-cols-2 md:gap-12">
        <ProviderLimits provider="claude" entries={by("claude")} now={now} />
        <ProviderLimits provider="codex" entries={by("codex")} now={now} />
      </div>
    </section>
  );
}
