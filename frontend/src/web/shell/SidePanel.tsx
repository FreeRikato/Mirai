import { cn } from "cn";
import { useRef, useState, useSyncExternalStore, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";

export type PanelId = "machines-rail" | "tasks-sidebar" | "ship-sidebar" | "later-sidebar" | "later-list" | "later-queue" | "tasks-drawer" | "ship-preview" | "notes-side" | "peek" | "mirai";

type PanelSpec = { side: "left" | "right"; initial: number; min: number; max: number; label: string };

export const PANELS: Record<PanelId, PanelSpec> = {
  "machines-rail": { side: "left", initial: 260, min: 200, max: 420, label: "machine list" },
  "tasks-sidebar": { side: "left", initial: 260, min: 200, max: 420, label: "tasks sidebar" },
  "ship-sidebar": { side: "left", initial: 240, min: 200, max: 400, label: "ship sidebar" },
  "later-sidebar": { side: "left", initial: 220, min: 180, max: 360, label: "later sidebar" },
  "later-list": { side: "left", initial: 440, min: 320, max: 640, label: "later list" },
  "later-queue": { side: "left", initial: 280, min: 220, max: 420, label: "up next" },
  "tasks-drawer": { side: "right", initial: 360, min: 300, max: 720, label: "details" },
  "ship-preview": { side: "right", initial: 360, min: 300, max: 760, label: "preview" },
  "notes-side": { side: "right", initial: 340, min: 280, max: 560, label: "note links" },
  peek: { side: "right", initial: 400, min: 300, max: 760, label: "linked item" },
  mirai: { side: "right", initial: 380, min: 320, max: 720, label: "mirAI" },
};

export const MAX_SHARE = 0.45;
const STEP = 16;

const safeStorage: StateStorage = {
  getItem: key => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem: (key, value) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      return;
    }
  },
  removeItem: key => {
    try {
      localStorage.removeItem(key);
    } catch {
      return;
    }
  },
};

type PanelWidths = {
  widths: Partial<Record<PanelId, number>>;
  setWidth: (id: PanelId, width: number) => void;
  reset: (id: PanelId) => void;
};

const usePanelWidths = create<PanelWidths>()(
  persist(
    set => ({
      widths: {},
      setWidth: (id, width) => set(s => ({ widths: { ...s.widths, [id]: width } })),
      reset: id =>
        set(s => {
          const { [id]: _, ...rest } = s.widths;
          return { widths: rest };
        }),
    }),
    { name: "mirai-panels", storage: createJSONStorage(() => safeStorage), partialize: s => ({ widths: s.widths }) },
  ),
);

function useViewportWidth(): number {
  return useSyncExternalStore(
    onChange => {
      window.addEventListener("resize", onChange);
      return () => window.removeEventListener("resize", onChange);
    },
    () => window.innerWidth,
  );
}

export function panelBounds(id: PanelId, viewport: number): { min: number; max: number } {
  const p = PANELS[id];
  return { min: p.min, max: Math.max(p.min, Math.min(p.max, Math.floor(viewport * MAX_SHARE))) };
}

const clamp = (n: number, b: { min: number; max: number }) => Math.round(Math.min(b.max, Math.max(b.min, n)));

export function SidePanel({ id, label, className, children }: { id: PanelId; label?: string; className?: string; children: ReactNode }) {
  const bounds = panelBounds(id, useViewportWidth());
  const stored = usePanelWidths(s => s.widths[id]);
  const width = clamp(stored ?? PANELS[id].initial, bounds);
  return (
    <aside aria-label={label} data-panel={id} style={{ width }} className={cn("relative shrink-0", PANELS[id].side === "left" ? "border-r" : "border-l", "border-rule", className)}>
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">{children}</div>
      <ResizeHandle id={id} width={width} min={bounds.min} max={bounds.max} />
    </aside>
  );
}

function ResizeHandle({ id, width, min, max }: { id: PanelId; width: number; min: number; max: number }) {
  const { side, label } = PANELS[id];
  const bounds = { min, max };
  const setWidth = usePanelWidths(s => s.setWidth);
  const reset = usePanelWidths(s => s.reset);
  const start = useRef<{ x: number; width: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const grow = side === "left" ? 1 : -1;

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = { x: e.clientX, width };
    setDragging(true);
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    setWidth(id, clamp(start.current.width + grow * (e.clientX - start.current.x), bounds));
  };
  const stop = () => {
    start.current = null;
    setDragging(false);
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const next =
      e.key === "ArrowRight" ? width + grow * STEP : e.key === "ArrowLeft" ? width - grow * STEP : e.key === "Home" ? bounds.min : e.key === "End" ? bounds.max : null;
    if (next === null) return;
    e.preventDefault();
    e.stopPropagation();
    setWidth(id, clamp(next, bounds));
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={`resize ${label}`}
      aria-valuenow={width}
      aria-valuemin={bounds.min}
      aria-valuemax={bounds.max}
      tabIndex={0}
      data-dragging={dragging || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={stop}
      onPointerCancel={stop}
      onLostPointerCapture={stop}
      onDoubleClick={() => reset(id)}
      onKeyDown={onKeyDown}
      className={cn(
        "absolute inset-y-0 z-20 w-2 cursor-col-resize touch-none outline-none",
        "after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 hover:after:bg-fg focus-visible:after:bg-fg data-[dragging]:after:bg-fg",
        side === "left" ? "-right-1" : "-left-1",
      )}
    />
  );
}
