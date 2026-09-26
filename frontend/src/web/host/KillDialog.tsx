import { OctagonX } from "lucide-react";
import type { KillSignal } from "@/shared/schema";
import { Button } from "@/components/ui/button";
import { useKill } from "../api";
import { Modal } from "../Modal";

export type KillTarget = { pid: number; name: string; command: string | null };

export function KillButton({ target, onPick }: { target: KillTarget; onPick: (t: KillTarget) => void }) {
  return (
    <button
      type="button"
      aria-label={`kill ${target.name} (${target.pid})`}
      onClick={() => onPick(target)}
      className="inline-flex cursor-pointer border-0 bg-transparent p-0 align-middle pointer-coarse:p-2.5 text-dim hover:text-bad focus-visible:text-bad focus-visible:opacity-100 pointer-fine:opacity-0 pointer-fine:group-hover/row:opacity-100"
    >
      <OctagonX aria-hidden className="size-3.5" strokeWidth={1.75} />
    </button>
  );
}

export function KillDialog({ host, target, onClose }: { host: string; target: KillTarget | null; onClose: () => void }) {
  const kill = useKill(host);
  const close = () => {
    kill.reset();
    onClose();
  };
  const send = (signal: KillSignal) => {
    if (target) kill.mutate({ pid: target.pid, name: target.name, signal }, { onSuccess: close });
  };
  const button = "font-mono text-[11px]";

  return (
    <Modal
      open={target !== null}
      onClose={close}
      title={`kill ${target?.name ?? ""}?`}
      description={`pid ${target?.pid ?? ""} on ${host}`}
      actions={
        <>
          <Button variant="ghost" size="sm" className={button} onClick={close} disabled={kill.isPending}>
            cancel
          </Button>
          <Button variant="outline" size="sm" className={`${button} border-rule`} onClick={() => send("SIGTERM")} disabled={kill.isPending}>
            terminate
          </Button>
          <Button variant="destructive" size="sm" className={button} onClick={() => send("SIGKILL")} disabled={kill.isPending}>
            force kill
          </Button>
        </>
      }
    >
      {target?.command && <p className="m-0 line-clamp-3 text-[11px] break-all text-dim">{target.command}</p>}
      {kill.error && (
        <p role="alert" className="m-0 text-[11px] text-bad">
          {kill.error.message}
        </p>
      )}
    </Modal>
  );
}
