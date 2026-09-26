import type { ReactNode } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useIsDesktop } from "./hooks";

type ModalProps = {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description: ReactNode;
  children?: ReactNode;
  actions: ReactNode;
};

export function Modal({ open, onClose, title, description, children, actions }: ModalProps) {
  const desktop = useIsDesktop();
  const onOpenChange = (next: boolean) => !next && onClose();

  if (desktop) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="gap-4 border-rule bg-popover font-mono sm:max-w-md" showCloseButton={false}>
          <DialogHeader className="gap-1.5 text-left">
            <DialogTitle className="text-[15px]">{title}</DialogTitle>
            <DialogDescription className="text-[11px] text-dim">{description}</DialogDescription>
          </DialogHeader>
          {children}
          <DialogFooter className="gap-2">{actions}</DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" showCloseButton={false} className="gap-3 border-rule bg-popover px-5 pt-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] font-mono">
        <SheetHeader className="gap-1 p-0">
          <SheetTitle className="text-[15px]">{title}</SheetTitle>
          <SheetDescription className="text-[11px] text-dim">{description}</SheetDescription>
        </SheetHeader>
        {children}
        <SheetFooter className="flex-col-reverse gap-2 p-0 pt-2 [&>button]:h-11 [&>button]:w-full">{actions}</SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
