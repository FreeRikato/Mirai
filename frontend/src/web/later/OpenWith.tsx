import { cn } from "cn";
import { ExternalLink, MonitorUp, ShieldOff, type LucideIcon } from "lucide-react";
import type { LaterItem } from "@/shared/later";
import { useFleet } from "../api";
import { useSend } from "./api";
import { useLaterUi } from "./store";

export function useTargets(): { targets: string[]; target: string | null; setTarget: (m: string) => void } {
  const { data: fleet } = useFleet();
  const chosen = useLaterUi(s => s.machine);
  const setTarget = useLaterUi(s => s.setMachine);
  const live = (fleet?.machines ?? []).filter(m => m.kind === "live");
  const targets = [...live.filter(m => m.ts.os === "macOS"), ...live.filter(m => m.ts.os !== "macOS")].map(m => m.ts.name);
  return { targets, target: chosen && targets.includes(chosen) ? chosen : (targets[0] ?? null), setTarget };
}

export function useSendTo(item: LaterItem | null) {
  const send = useSend();
  const { target } = useTargets();
  return {
    target,
    run: (machine = target) => item && machine && send.mutate({ id: item.id, machine }),
    status: send.isPending ? "sending" : send.isError ? send.error.message : send.isSuccess ? `opened on ${send.variables.machine}` : null,
    failed: send.isError,
  };
}

export function SendButton({ item, compact }: { item: LaterItem; compact?: boolean }) {
  const { targets, target, setTarget } = useTargets();
  const send = useSendTo(item);
  if (!target) return null;
  return (
    <span className="flex items-center border border-fg">
      <button type="button" onClick={() => send.run()} title={send.status ?? `open on ${target} (s)`} className="flex cursor-pointer items-center gap-1.5 border-0 bg-transparent px-2 py-1 font-mono text-[10px] text-fg">
        <MonitorUp aria-hidden className="size-3" />
        {compact ? target : `send to ${target}`}
      </button>
      {targets.length > 1 && (
        <select aria-label="machine to open on" value={target} onChange={e => setTarget(e.target.value)} className="h-full cursor-pointer border-0 border-l border-rule bg-bg px-1 font-mono text-[10px] text-dim outline-none">
          {targets.map(t => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      )}
      {send.status && <span className={cn("px-2 text-[10px]", send.failed ? "text-bad" : "text-dim")}>{send.status}</span>}
    </span>
  );
}

function Option({ icon: Icon, label, hint, keyHint, primary, onClick, href }: { icon: LucideIcon; label: string; hint: string; keyHint: string; primary?: boolean; onClick?: () => void; href?: string }) {
  const body = (
    <>
      <Icon aria-hidden className={cn("size-3.5", primary ? "text-fg" : "text-dim")} />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className={cn("text-[12px]", primary ? "text-fg" : "text-soft")}>{label}</span>
        <span className="text-[10px] text-dim">{hint}</span>
      </span>
      <span className="font-key text-[10px] text-dim">{keyHint}</span>
    </>
  );
  const cls = cn("flex w-full cursor-pointer items-center gap-3 border px-3 py-2.5 text-left font-mono no-underline", primary ? "border-fg bg-raise" : "border-rule bg-transparent hover:border-dim");
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" data-external className={cls}>
      {body}
    </a>
  ) : (
    <button type="button" onClick={onClick} className={cls}>
      {body}
    </button>
  );
}

export function OpenWith({ item, reason }: { item: LaterItem; reason: string }) {
  const send = useSendTo(item);
  return (
    <div className="grid h-full place-items-center overflow-y-auto p-6">
      <div className="flex w-full max-w-[520px] flex-col gap-4">
        <span className="flex items-center gap-2.5 text-[12px] text-warn">
          <ShieldOff aria-hidden className="size-4" />
          {reason}
        </span>
        <h2 className="m-0 font-serif text-[24px] leading-tight font-semibold">{item.title}</h2>
        <span className="text-[10px] text-dim">
          {[item.author, item.site].filter(Boolean).join(" · ")}
        </span>
        {item.tldr.length > 0 && <Tldr item={item} />}
        <div className="flex flex-col gap-2">
          <span className="text-[10px] text-dim">open with</span>
          {send.target && <Option icon={MonitorUp} label={`send to ${send.target}`} hint="opens in the default app there" keyHint="s" primary onClick={() => send.run()} />}
          <Option icon={ExternalLink} label="new tab here" hint={`${item.site} in this browser`} keyHint="o" href={item.url} />
          {send.status && <span className={cn("text-[10px]", send.failed ? "text-bad" : "text-dim")}>{send.status}</span>}
        </div>
      </div>
    </div>
  );
}

export function Tldr({ item }: { item: LaterItem }) {
  return (
    <section aria-label="mirAI tl;dr" className="flex flex-col gap-1.5 border-l-2 border-fg bg-popover px-4 py-3">
      <span className="flex items-center justify-between gap-3 text-[10px]">
        <span>mirAI tl;dr</span>
        <span className="text-faint">mock</span>
      </span>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {item.tldr.map(t => (
          <li key={t} className="font-serif text-[14px] leading-snug">
            {t}
          </li>
        ))}
      </ul>
    </section>
  );
}
