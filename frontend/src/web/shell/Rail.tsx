import { cn } from "cn";
import type { Fleet, Machine } from "@/shared/schema";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { useFleet } from "../api";
import { pathLabel, type Tone } from "../derive";
import { ago, duration, pct } from "../format";
import { hrefFor, navigate, routeHost, useRoute } from "../router";
import { useUi } from "../store";
import { Bar, toneClass } from "../ui";
import { ModuleNav } from "./ModuleNav";
import { useSettings } from "../settings";
import { SidePanel } from "./SidePanel";

function RailLink({ href, selected, accent, children, className }: { href: string; selected: boolean; accent: string; children: React.ReactNode; className?: string }) {
  return (
    <a
      href={href}
      aria-current={selected ? "page" : undefined}
      onClick={e => {
        e.preventDefault();
        navigate(href);
        useUi.getState().setNavOpen(false);
      }}
      className={cn("flex flex-col gap-2 border-l-[3px] px-5 py-3.5 text-fg no-underline hover:bg-raise", selected ? "bg-raise" : "border-transparent", className)}
      style={selected ? { borderLeftColor: accent } : undefined}
    >
      {children}
    </a>
  );
}

function MachineEntry({ m, pathText, pathTone, selected }: { m: Machine; pathText: string; pathTone: Tone; selected: boolean }) {
  const { fleet: limits } = useSettings();
  const live = m.kind === "live" ? m.metrics : null;
  const cpu = live?.cpu.load ?? 0;
  const mem = live ? (live.mem.used / live.mem.total) * 100 : 0;
  const status = m.kind === "offline" ? `offline, seen ${ago(m.ts.lastSeen)} ago` : m.kind === "no-agent" ? "no agent" : pathText;
  const extra = live ? [live.battery && `bat ${pct(live.battery.percent)}${live.battery.charging ? " charging" : ""}`, `up ${duration(live.uptimeSec)}`].filter(Boolean).join("  ") : null;

  return (
    <RailLink href={hrefFor(m.ts.name)} selected={selected} accent={m.color} className={cn(m.kind === "offline" && "opacity-50")}>
      <div className="flex justify-between">
        <span className="text-[13px] font-semibold" style={{ color: selected ? undefined : m.color }}>
          {m.ts.name}
        </span>
        <span className={cpu >= limits.loadHotPct ? "text-bad" : "text-dim"}>{live ? pct(cpu) : "--"}</span>
      </div>
      {(["cpu", "mem"] as const).map(k => (
        <div key={k} className="flex items-center gap-2">
          <span className="w-7 text-[10px] text-dim">{k}</span>
          <Bar value={live ? (k === "cpu" ? cpu : mem) : 0} hotAt={limits.loadHotPct} color={m.color} />
        </div>
      ))}
      <span className={cn("text-[10px]", m.kind === "live" ? toneClass[pathTone] : "text-dim")}>{status}</span>
      {extra && <span className="text-[10px] text-dim">{extra}</span>}
    </RailLink>
  );
}

function RailNav({ fleet }: { fleet: Fleet }) {
  const host = routeHost(useRoute());
  const online = fleet.machines.filter(m => m.kind !== "offline").length;
  const relayed = fleet.edges.filter(e => e.via === "relay").length;

  return (
    <>
      <RailLink href={hrefFor(null)} selected={host === null} accent="var(--color-fg)" className="border-b border-b-rule pt-4">
        <div className="flex justify-between">
          <span className="text-[13px] font-semibold">fleet</span>
          <span className="text-dim">
            {online}/{fleet.machines.length}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {fleet.machines.map(m => (
            <span key={m.ts.name} className={cn("size-2 rounded-full", m.kind === "offline" && "opacity-40")} style={{ background: m.color }} />
          ))}
          {relayed > 0 && <span className="ml-2 text-[10px] text-warn">{relayed} relayed</span>}
        </div>
      </RailLink>
      {fleet.machines.map(m => {
        const path = pathLabel(fleet, m);
        return <MachineEntry key={m.ts.name} m={m} pathText={path.text} pathTone={path.tone} selected={host === m.ts.name} />;
      })}
    </>
  );
}

export function Rail() {
  const { data: fleet } = useFleet();
  return (
    <SidePanel id="machines-rail" className="hidden md:flex">
      {fleet && <RailNav fleet={fleet} />}
    </SidePanel>
  );
}

function DrawerMachines() {
  const { data: fleet } = useFleet();
  return fleet ? <RailNav fleet={fleet} /> : null;
}

export function NavDrawer() {
  const open = useUi(s => s.navOpen);
  const setOpen = useUi(s => s.setNavOpen);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent side="left" showCloseButton={false} className="w-[300px] gap-0 overflow-y-auto border-rule bg-bg pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] font-mono">
        <div className="flex items-center justify-between px-5 pt-3 pb-3">
          <SheetTitle className="font-dot text-[20px] leading-none font-black">mirai</SheetTitle>
          <button type="button" onClick={() => setOpen(false)} className="-m-2 cursor-pointer border-0 bg-transparent p-2 font-mono text-[11px] text-dim hover:text-fg">
            close
          </button>
        </div>
        <SheetDescription className="sr-only">Switch module or machine</SheetDescription>
        <ModuleNav className="h-9 shrink-0 gap-4 overflow-x-auto border-b border-rule px-5 whitespace-nowrap" onNavigate={() => setOpen(false)} />
        <DrawerMachines />
      </SheetContent>
    </Sheet>
  );
}
