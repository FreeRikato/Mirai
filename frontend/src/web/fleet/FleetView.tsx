import { cn } from "cn";
import type { Fleet, LoadRange, Machine, TailnetInfo } from "@/shared/schema";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useEvents, useLoad } from "../api";
import { edgeTo, isOutdated, pathLabel, type Tone } from "../derive";
import { bytes, clock } from "../format";
import { hrefFor, navigate } from "../router";
import { useUi } from "../store";
import { Ago, bodyCell, headCell as th, Heading, Page, PageHeader, Swatch, toneClass } from "../ui";
import { Mesh } from "./Mesh";
import { useSettings } from "../settings";

const sevClass = { bad: "text-bad", warn: "text-warn", info: "text-fg" } as const;

function Events() {
  const { data: events = [] } = useEvents();
  return (
    <section className="flex shrink-0 flex-col border-t border-rule py-5 @4xl:w-[340px] @4xl:border-t-0 @4xl:pl-6">
      <h2 className="m-0 pb-2.5 text-[13px] font-semibold">events</h2>
      {events.length === 0 && <p className="m-0 py-2 text-dim">nothing has changed since the hub started</p>}
      {events.map(e => (
        <div key={e.id} className="flex gap-3 border-b border-rule py-2">
          <span className="w-[52px] shrink-0 text-[10px] text-dim">{clock(e.at)}</span>
          <span className={sevClass[e.severity]}>{e.message}</span>
        </div>
      ))}
    </section>
  );
}

const td = cn(bodyCell, "py-[7px] text-[12px]");

type TailnetRowProps = { ts: TailnetInfo; color: string; kind: Machine["kind"]; pathText: string; pathTone: Tone; latencyMs: number | null; outdated: boolean };

function TailnetRow({ ts, color, kind, pathText, pathTone, latencyMs, outdated }: TailnetRowProps) {
  const self = ts.isSelf;
  return (
    <TableRow onClick={() => navigate(hrefFor(ts.name))} className={cn("cursor-pointer border-rule hover:bg-raise", kind === "offline" && "opacity-45")}>
      <TableCell className={td}>
        <a
          href={hrefFor(ts.name)}
          onClick={e => {
            e.preventDefault();
            e.stopPropagation();
            navigate(hrefFor(ts.name));
          }}
          className="flex items-center gap-2.5 text-fg no-underline outline-none focus-visible:underline"
        >
          <Swatch color={color} />
          {ts.name}
        </a>
      </TableCell>
      <TableCell className={cn(td, "hidden @3xl:table-cell")}>{ts.os}</TableCell>
      <TableCell className={cn(td, "hidden @xl:table-cell")}>{ts.ip}</TableCell>
      <TableCell className={cn(td, "hidden @xl:table-cell", outdated && "text-warn")}>{ts.version || "--"}</TableCell>
      <TableCell className={cn(td, toneClass[pathTone])}>{pathText}</TableCell>
      <TableCell className={cn(td, "text-right", pathTone === "warn" && "text-warn", self && "text-dim")}>{latencyMs != null ? `${latencyMs} ms` : "--"}</TableCell>
      <TableCell className={cn(td, "hidden text-right @3xl:table-cell", self && "text-dim")}>{self ? "--" : bytes(ts.rxBytes)}</TableCell>
      <TableCell className={cn(td, "hidden text-right @3xl:table-cell", self && "text-dim")}>{self ? "--" : bytes(ts.txBytes)}</TableCell>
      <TableCell className={cn(td, "text-right")}>{kind === "offline" ? <Ago at={ts.lastSeen} /> : "now"}</TableCell>
    </TableRow>
  );
}

function TailnetTable({ fleet }: { fleet: Fleet }) {
  const online = fleet.machines.filter(m => m.kind !== "offline").length;
  return (
    <section className="flex flex-col gap-2.5">
      <Heading right={[fleet.tailnet, "magicdns on", `${fleet.machines.length} machines, ${online} online`].map(t => <span key={t}>{t}</span>)}>tailnet</Heading>
      <Table className="table-fixed">
        <TableHeader>
          <TableRow className="border-rule hover:bg-transparent">
            <TableHead className={th}>machine</TableHead>
            <TableHead className={cn(th, "hidden w-[80px] @3xl:table-cell")}>os</TableHead>
            <TableHead className={cn(th, "hidden w-[130px] @xl:table-cell")}>addr</TableHead>
            <TableHead className={cn(th, "hidden w-[80px] @xl:table-cell")}>version</TableHead>
            <TableHead className={cn(th, "w-[96px] @xl:w-[110px]")}>path</TableHead>
            <TableHead className={cn(th, "w-[64px] text-right @xl:w-[70px]")}>latency</TableHead>
            <TableHead className={cn(th, "hidden w-[70px] text-right @3xl:table-cell")}>rx</TableHead>
            <TableHead className={cn(th, "hidden w-[70px] text-right @3xl:table-cell")}>tx</TableHead>
            <TableHead className={cn(th, "w-[44px] text-right @xl:w-[60px]")}>seen</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {fleet.machines.map(m => {
            const path = pathLabel(fleet, m);
            return (
              <TailnetRow
                key={m.ts.name}
                ts={m.ts}
                color={m.color}
                kind={m.kind}
                pathText={path.text}
                pathTone={path.tone}
                latencyMs={edgeTo(fleet, m.ts.name)?.ms ?? null}
                outdated={isOutdated(m, fleet.latestVersion)}
              />
            );
          })}
        </TableBody>
      </Table>
    </section>
  );
}

const RANGES: readonly LoadRange[] = ["1h", "24h", "7d"];
const AXIS: Record<LoadRange, string[]> = {
  "1h": ["-60m", "-45m", "-30m", "-15m", "now"],
  "24h": ["-24h", "-18h", "-12h", "-6h", "now"],
  "7d": ["-7d", "-5d 6h", "-3d 12h", "-1d 18h", "now"],
};

const NO_VALUES: readonly (number | null)[] = [];

function LoadBars({ name, color, values, buckets }: { name: string; color: string; values: readonly (number | null)[]; buckets: number }) {
  return (
    <div className="flex h-4 min-w-0 flex-1 gap-px @xl:h-[22px] @xl:gap-[2px]" aria-label={`${name} cpu history`}>
      {Array.from({ length: buckets }, (_, i) => {
        const v = values[i];
        return v == null ? (
          <span key={i} className="flex-1 bg-track" />
        ) : (
          <span key={i} className="flex-1" style={{ background: color, opacity: 0.22 + 0.78 * Math.min(1, v / 100) }} />
        );
      })}
    </div>
  );
}

function LoadStrip({ fleet }: { fleet: Fleet }) {
  const { fleet: limits } = useSettings();
  const range = useUi(s => s.loadRange);
  const setRange = useUi(s => s.setLoadRange);
  const { data } = useLoad(range);
  const byMachine = new Map(data?.rows.map(r => [r.machine, r.values]));
  const buckets = data?.buckets ?? 96;

  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between pb-1.5">
        <h2 className="m-0 font-dot text-[24px] font-black">load / {range}</h2>
        <div className="flex items-center gap-4">
          {RANGES.map(r => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              className={cn("cursor-pointer border-0 bg-transparent p-0 font-mono text-[11px] pointer-coarse:-my-3 pointer-coarse:px-2 pointer-coarse:py-3", r === range ? "text-fg underline" : "text-dim")}
            >
              {r}
            </button>
          ))}
        </div>
      </div>
      {fleet.machines.map(m => {
        return (
          <div key={m.ts.name} className="flex flex-col gap-1 @xl:flex-row @xl:items-center @xl:gap-5">
            <span className="shrink-0 text-[10px] @xl:w-24 @xl:text-[11px]" style={{ color: m.color }}>
              {m.ts.name}
            </span>
            <LoadBars name={m.ts.name} color={m.color} values={byMachine.get(m.ts.name) ?? NO_VALUES} buckets={buckets} />
            <div className="hidden w-[480px] shrink-0 justify-end gap-3.5 overflow-hidden text-[10px] @4xl:flex">
              {m.kind === "live" ? (
                m.metrics.topProcs.map((p, i) => (
                  <span key={`${i}-${p.name}`} className={cn("max-w-[160px] truncate", p.cpu >= limits.loadHotPct ? "text-bad" : "text-fg")}>
                    {p.name} {p.cpu}
                  </span>
                ))
              ) : (
                <span className="text-dim">{m.kind === "offline" ? (m.ts.lastSeen ? `offline since ${clock(Date.parse(m.ts.lastSeen))}` : "offline") : "no agent"}</span>
              )}
            </div>
          </div>
        );
      })}
      <div className="flex gap-5">
        <span className="hidden w-24 shrink-0 @xl:block" />
        <div className="flex flex-1 justify-between text-[10px] text-dim">
          {AXIS[range].map(t => (
            <span key={t}>{t}</span>
          ))}
        </div>
        <span className="hidden w-[480px] shrink-0 @4xl:block" />
      </div>
    </section>
  );
}

export function FleetView({ fleet }: { fleet: Fleet }) {
  const online = fleet.machines.filter(m => m.kind !== "offline").length;
  return (
    <Page>
      <PageHeader title="fleet">
        <p className="m-0 text-dim">
          {fleet.tailnet}&nbsp;&nbsp; {fleet.machines.length} machines&nbsp;&nbsp; {online} online&nbsp;&nbsp; refreshed <Ago at={fleet.at} />
        </p>
      </PageHeader>
      <div className="flex flex-col border-y border-rule @4xl:h-[540px] @4xl:flex-row">
        <div className="min-w-0 flex-1 @4xl:border-r @4xl:border-rule">
          <Mesh />
        </div>
        <Events />
      </div>
      <TailnetTable fleet={fleet} />
      <LoadStrip fleet={fleet} />
    </Page>
  );
}
