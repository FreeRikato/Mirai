import { cn } from "cn";
import { useState, type DragEvent } from "react";
import type { Side } from "./derive";

type Drag = { id: string; over: { id: string; side: Side } | null };

export type Place = (id: string, target: string, side: Side) => void;

export function useDragOrder(onPlace: Place | undefined) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const rowProps = (id: string) =>
    onPlace
      ? {
          draggable: true,
          onDragStart: (e: DragEvent<HTMLElement>) => {
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", id);
            setDrag({ id, over: null });
          },
          onDragOver: (e: DragEvent<HTMLElement>) => {
            if (!drag) return;
            e.preventDefault();
            const r = e.currentTarget.getBoundingClientRect();
            const side: Side = e.clientY < r.top + r.height / 2 ? "before" : "after";
            if (drag.over?.id !== id || drag.over.side !== side) setDrag({ ...drag, over: { id, side } });
          },
          onDrop: (e: DragEvent<HTMLElement>) => {
            e.preventDefault();
            if (drag?.over && drag.over.id !== drag.id) onPlace(drag.id, drag.over.id, drag.over.side);
            setDrag(null);
          },
          onDragEnd: () => setDrag(null),
        }
      : {};
  const lineAt = (id: string): Side | null => (drag?.over?.id === id && drag.id !== id ? drag.over.side : null);
  return { rowProps, lineAt, dragging: drag?.id ?? null };
}

export type RowDrag = ReturnType<ReturnType<typeof useDragOrder>["rowProps"]>;

export function DropLine({ side }: { side: Side | null }) {
  if (!side) return null;
  return <span data-testid="drop-line" aria-hidden className={cn("pointer-events-none absolute inset-x-0 z-10 h-0.5 bg-fg", side === "before" ? "-top-px" : "-bottom-px")} />;
}
