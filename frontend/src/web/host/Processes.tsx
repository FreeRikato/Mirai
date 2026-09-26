import { cn } from "cn";
import { useState } from "react";
import type { HostDetail, Port, Process } from "@/shared/schema";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { bytes, clock } from "../format";
import { useReveal } from "../hooks";
import { useUi, type ProcessTab } from "../store";
import { bodyCell as td, headCell as th, narrowOnly } from "../ui";
import { KillButton, KillDialog, type KillTarget } from "./KillDialog";
import { useSettings } from "../settings";

const TABS: readonly ProcessTab[] = ["cpu", "memory", "ports"];
const isTab = (v: string): v is ProcessTab => TABS.some(t => t === v);

const rowClass = "group/row border-rule hover:bg-raise";
const actionHead = cn(th, "w-9");
const actionCell = cn(td, "text-center");

function ProcessRow({ p, hotPct, onKill }: { p: Process; hotPct: number; onKill: (t: KillTarget) => void }) {
  return (
    <TableRow className={rowClass} title={p.command}>
      <TableCell className={cn(td, "hidden text-dim @xl:table-cell")}>{p.pid}</TableCell>
      <TableCell className={cn(td, "truncate")}>
        {p.name}
        <span className={cn(narrowOnly, "truncate")}>
          {p.pid} · {p.user}
        </span>
      </TableCell>
      <TableCell className={cn(td, "hidden truncate text-dim @3xl:table-cell")}>{p.user}</TableCell>
      <TableCell className={cn(td, "text-right")}>
        <span className={cn(p.cpu >= hotPct && "text-bad")}>{p.cpu.toFixed(1)}</span>
        <span className={narrowOnly}>{bytes(p.memBytes)}</span>
      </TableCell>
      <TableCell className={cn(td, "hidden text-right @xl:table-cell")}>{bytes(p.memBytes)}</TableCell>
      <TableCell className={cn(td, "hidden text-right text-dim @3xl:table-cell")}>{clock(Date.parse(p.started.replace(" ", "T")))}</TableCell>
      <TableCell className={actionCell}>{p.killable !== false && <KillButton target={{ pid: p.pid, name: p.name, command: p.command }} onPick={onKill} />}</TableCell>
    </TableRow>
  );
}

function ProcessTable({ rows, onKill }: { rows: readonly Process[]; onKill: (t: KillTarget) => void }) {
  const { fleet: limits } = useSettings();
  return (
    <Table className="table-fixed">
      <TableHeader>
        <TableRow className="border-rule hover:bg-transparent">
          <TableHead className={cn(th, "hidden w-[80px] @xl:table-cell")}>pid</TableHead>
          <TableHead className={th}>process</TableHead>
          <TableHead className={cn(th, "hidden w-[110px] @3xl:table-cell")}>user</TableHead>
          <TableHead className={cn(th, "w-[70px] text-right")}>cpu%</TableHead>
          <TableHead className={cn(th, "hidden w-[80px] text-right @xl:table-cell")}>mem</TableHead>
          <TableHead className={cn(th, "hidden w-[90px] text-right @3xl:table-cell")}>started</TableHead>
          <TableHead className={actionHead}>
            <span className="sr-only">actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map(p => (
          <ProcessRow key={p.pid} p={p} hotPct={limits.loadHotPct} onKill={onKill} />
        ))}
      </TableBody>
    </Table>
  );
}

function PortRow({ p, proc, onKill }: { p: Port; proc: Process | undefined; onKill: (t: KillTarget) => void }) {
  const canKill = p.pid !== null && Boolean(p.process || proc) && proc?.killable !== false;
  return (
    <TableRow className={rowClass}>
      <TableCell className={td}>
        :{p.port}
        <span className={narrowOnly}>{p.proto}</span>
      </TableCell>
      <TableCell className={cn(td, "hidden text-dim @xl:table-cell")}>{p.proto}</TableCell>
      <TableCell className={cn(td, "truncate")}>
        {p.process || "--"}
        <span className={narrowOnly}>{p.pid ?? "--"}</span>
      </TableCell>
      <TableCell className={cn(td, "hidden text-right text-dim @xl:table-cell")}>{p.pid ?? "--"}</TableCell>
      <TableCell className={cn(td, "hidden text-right text-dim @3xl:table-cell")}>{p.bind}</TableCell>
      <TableCell className={actionCell}>
        {canKill && p.pid !== null && <KillButton target={{ pid: p.pid, name: proc?.name ?? p.process, command: proc?.command ?? null }} onPick={onKill} />}
      </TableCell>
    </TableRow>
  );
}

function PortTable({ rows, processes, onKill }: { rows: readonly Port[]; processes: readonly Process[]; onKill: (t: KillTarget) => void }) {
  const byPid = new Map(processes.map(p => [p.pid, p]));
  return (
    <Table className="table-fixed">
      <TableHeader>
        <TableRow className="border-rule hover:bg-transparent">
          <TableHead className={cn(th, "w-[70px] @xl:w-[80px]")}>port</TableHead>
          <TableHead className={cn(th, "hidden w-[60px] @xl:table-cell")}>proto</TableHead>
          <TableHead className={th}>process</TableHead>
          <TableHead className={cn(th, "hidden w-[80px] text-right @xl:table-cell")}>pid</TableHead>
          <TableHead className={cn(th, "hidden w-[160px] text-right @3xl:table-cell")}>bind</TableHead>
          <TableHead className={actionHead}>
            <span className="sr-only">actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map(p => (
          <PortRow key={`${p.port}-${p.proto}-${p.pid}`} p={p} proc={p.pid === null ? undefined : byPid.get(p.pid)} onKill={onKill} />
        ))}
      </TableBody>
    </Table>
  );
}

export function Processes({ host, detail, note }: { host: string; detail: HostDetail; note: string | null }) {
  const tab = useUi(s => s.processTab);
  const setTab = useUi(s => s.setProcessTab);
  const [target, setTarget] = useState<KillTarget | null>(null);
  const procs = tab === "memory" ? [...detail.processes].sort((a, b) => b.memBytes - a.memBytes) : detail.processes;
  const total = tab === "ports" ? detail.ports.length : procs.length;
  const { shown, footer } = useReveal(total, tab);

  return (
    <Tabs value={tab} onValueChange={v => isTab(v) && setTab(v)} className="gap-2.5">
      <div className="flex items-center justify-between gap-3">
        <TabsList variant="line" className="h-auto gap-5 p-0">
          {TABS.map(t => (
            <TabsTrigger key={t} value={t} className="h-auto flex-none px-0 py-1 font-mono text-[13px] text-dim data-[state=active]:font-semibold data-[state=active]:text-fg">
              {t}
            </TabsTrigger>
          ))}
        </TabsList>
        <span className="flex flex-wrap justify-end gap-x-3 text-right">
          {note && <span className="text-warn">{note}</span>}
          <span className="text-dim">
            {shown} of {total} {tab === "ports" ? "listening" : "processes"}
          </span>
        </span>
      </div>
      <TabsContent value="ports">
        <PortTable rows={detail.ports.slice(0, shown)} processes={detail.processes} onKill={setTarget} />
        {footer}
      </TabsContent>
      {(["cpu", "memory"] as const).map(t => (
        <TabsContent key={t} value={t}>
          <ProcessTable rows={procs.slice(0, shown)} onKill={setTarget} />
          {footer}
        </TabsContent>
      ))}
      <KillDialog host={host} target={target} onClose={() => setTarget(null)} />
    </Tabs>
  );
}
