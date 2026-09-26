import type { LaterKind } from "@/shared/later";
import type { ListView } from "../router";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { Budget, LaterQueue } from "./derive";

export const READER_FACES = ["serif", "sans", "mono"] as const;
export type ReaderFace = (typeof READER_FACES)[number];
export const READER_WIDTHS = ["narrow", "wide", "full"] as const;
export type ReaderWidth = (typeof READER_WIDTHS)[number];
export const READER_MAX_WIDTH: Record<ReaderWidth, string> = { narrow: "640px", wide: "880px", full: "none" };
export const nextWidth = (w: ReaderWidth): ReaderWidth => READER_WIDTHS[(READER_WIDTHS.indexOf(w) + 1) % READER_WIDTHS.length] ?? w;
export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 3.5, 4] as const;
export type Speed = (typeof SPEEDS)[number];
export type WatchTab = "chapters" | "transcript" | "notes";

export const FONT_MIN = 14;
export const FONT_MAX = 24;

type LaterUi = {
  selected: Partial<Record<string, string>>;
  lastKind: LaterKind;
  queue: LaterQueue;
  budget: Budget;
  site: string | null;
  text: string;
  focus: boolean;
  fontSize: number;
  face: ReaderFace;
  width: ReaderWidth;
  speed: Speed;
  captions: boolean;
  watchTab: WatchTab;
  machine: string | null;
  select: (view: string, id: string | null) => void;
  setLastKind: (kind: LaterKind) => void;
  reveal: (kind: LaterKind, id: string) => void;
  setQueue: (queue: LaterQueue) => void;
  setBudget: (budget: Budget) => void;
  setSite: (site: string | null) => void;
  setText: (text: string) => void;
  setFocus: (focus: boolean) => void;
  bumpFont: (by: 1 | -1) => void;
  setFace: (face: ReaderFace) => void;
  setWidth: (width: ReaderWidth) => void;
  setSpeed: (speed: Speed) => void;
  setCaptions: (captions: boolean) => void;
  setWatchTab: (watchTab: WatchTab) => void;
  setMachine: (machine: string) => void;
};

export const useLaterUi = create<LaterUi>()(
  persist(
    set => ({
      selected: {},
      lastKind: "read",
      queue: "queue",
      budget: null,
      site: null,
      text: "",
      focus: false,
      fontSize: 17,
      face: "serif",
      width: "narrow",
      speed: 1,
      captions: false,
      watchTab: "chapters",
      machine: null,
      select: (view, id) => set(s => ({ selected: { ...s.selected, [view]: id ?? undefined } })),
      setLastKind: lastKind => set({ lastKind }),
      reveal: (kind, id) => set(s => ({ selected: { ...s.selected, [kind]: id }, queue: "queue", budget: null, site: null, text: "" })),
      setQueue: queue => set({ queue, site: null }),
      setBudget: budget => set({ budget }),
      setSite: site => set({ site }),
      setText: text => set({ text }),
      setFocus: focus => set({ focus }),
      bumpFont: by => set(s => ({ fontSize: Math.min(FONT_MAX, Math.max(FONT_MIN, s.fontSize + by)) })),
      setFace: face => set({ face }),
      setWidth: width => set({ width }),
      setSpeed: speed => set({ speed }),
      setCaptions: captions => set({ captions }),
      setWatchTab: watchTab => set({ watchTab }),
      setMachine: machine => set({ machine }),
    }),
    {
      name: "mirai-later",
      storage: createJSONStorage(() => localStorage),
      partialize: s => ({ lastKind: s.lastKind, fontSize: s.fontSize, face: s.face, width: s.width, speed: s.speed, captions: s.captions, machine: s.machine, budget: s.budget }),
    },
  ),
);

export const viewKey = (view: ListView): string => (view.by === "kind" ? view.kind : `folder:${view.folder}`);
