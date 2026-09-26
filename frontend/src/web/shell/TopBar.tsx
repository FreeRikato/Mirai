import { cn } from "cn";
import { Menu, Search } from "lucide-react";
import { useFleetSlice, useHubLink } from "../api";
import { ago } from "../format";
import { useNow } from "../hooks";
import { signals } from "../derive";
import { hrefFor, navigate } from "../router";
import { useSettings } from "../settings";
import { useUi } from "../store";
import { Px0Menu } from "../px0/Px0Menu";
import { ModuleNav } from "./ModuleNav";

const dotClass = { bad: "bg-bad", warn: "bg-warn", fg: "bg-fg", dim: "bg-dim" } as const;
const textClass = { bad: "text-bad", warn: "text-warn", fg: "text-fg", dim: "text-dim" } as const;
const iconButton = "-m-2 inline-flex cursor-pointer border-0 bg-transparent p-2 text-fg";

const DOWN_AFTER_MS = 4_000;

function HubOffline() {
  const { connected, since } = useHubLink();
  return connected ? null : <OfflineSince since={since} />;
}

function OfflineSince({ since }: { since: number }) {
  const now = useNow(2_000);
  if (now - since < DOWN_AFTER_MS) return null;
  return (
    <span role="status" className="flex shrink-0 items-center gap-1.5 font-mono text-[11px] whitespace-nowrap text-warn">
      <span className="size-1.5 shrink-0 rounded-full bg-warn" />
      hub offline {ago(since, now) === "now" ? "" : `${ago(since, now)} `}· retrying
    </span>
  );
}

export function TopBar() {
  const openPalette = useUi(s => s.setPaletteOpen);
  const openNav = useUi(s => s.setNavOpen);
  const { fleet: limits } = useSettings();
  const { data: list = [] } = useFleetSlice(fleet => (fleet ? signals(fleet, limits).slice(0, 3) : []));

  return (
    <header className="box-content flex h-11 shrink-0 items-center justify-between gap-3 border-b border-rule px-4 pt-[env(safe-area-inset-top)] md:gap-8 md:px-6">
      <div className="flex h-full shrink-0 items-center gap-4 md:gap-6">
        <button type="button" aria-label="open navigation" onClick={() => openNav(true)} className={cn(iconButton, "md:hidden")}>
          <Menu aria-hidden className="size-[18px]" />
        </button>
        <span className="font-dot text-[20px] leading-none font-black">mirai</span>
        <ModuleNav className="hidden h-full md:flex" />
      </div>
      <div className="flex min-w-0 items-center gap-4 md:gap-[18px]">
        <HubOffline />
        <Px0Menu />
        {list.map((s, i) => (
          <button
            key={s.key}
            type="button"
            onClick={() => navigate(hrefFor(s.machine))}
            className={cn(
              "min-w-0 shrink cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 font-mono text-[11px] whitespace-nowrap pointer-coarse:py-3",
              textClass[s.tone],
              i === 0 ? "flex" : "hidden md:flex",
            )}
          >
            <span className={cn("size-1.5 shrink-0 rounded-full", dotClass[s.tone])} />
            <span className="truncate">{s.text}</span>
          </button>
        ))}
        <button
          type="button"
          onClick={() => openPalette(true)}
          className="hidden h-[26px] w-60 shrink-0 cursor-pointer items-center justify-between border border-rule bg-transparent px-2.5 font-mono text-[11px] text-dim hover:border-dim md:flex"
        >
          search or ask mirAI
          <span className="font-key text-[12px] font-medium">⌘K</span>
        </button>
        <button type="button" aria-label="search or ask mirAI" onClick={() => openPalette(true)} className={cn(iconButton, "shrink-0 md:hidden")}>
          <Search aria-hidden className="size-[18px]" />
        </button>
      </div>
    </header>
  );
}
