import { cn } from "cn";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { useIsDesktop } from "../../hooks";
import { SidePanel, type PanelId } from "../../shell/SidePanel";

export function Drawer({ title, onClose, children, panel = "tasks-drawer" }: { title: string; onClose: () => void; children: ReactNode; panel?: PanelId }) {
  const desktop = useIsDesktop();

  if (desktop) {
    return (
      <SidePanel id={panel} label={title} className="flex">
        <CloseButton onClose={onClose} />
        {children}
      </SidePanel>
    );
  }

  return (
    <Sheet open onOpenChange={open => !open && onClose()}>
      <SheetContent side="bottom" showCloseButton={false} aria-label={title} className="max-h-[85dvh] gap-0 overflow-y-auto border-rule bg-bg pb-[env(safe-area-inset-bottom)] font-mono">
        <SheetTitle className="sr-only">{title}</SheetTitle>
        <SheetDescription className="sr-only">Task details</SheetDescription>
        <CloseButton onClose={onClose} />
        {children}
      </SheetContent>
    </Sheet>
  );
}

function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button type="button" aria-label="close details" onClick={onClose} className="absolute top-3.5 right-4 z-10 cursor-pointer border-0 bg-transparent p-1 text-dim hover:text-fg">
      <X aria-hidden className="size-3.5" />
    </button>
  );
}

export function DrawerSection({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cn("flex flex-col gap-2.5 border-b border-rule px-5 py-3.5", className)}>{children}</section>;
}
