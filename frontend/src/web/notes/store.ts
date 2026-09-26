import { create } from "zustand";

import type { Camera } from "./camera";

export type Scope = "global" | "local";

const TRAIL_MAX = 8;

type NotesUi = {
  camera: Camera | null;
  trail: string[];
  focus: string | null;
  hidden: string[];
  scope: Scope;
  depth: number;
  setCamera: (camera: Camera) => void;
  visit: (id: string) => void;
  setFocus: (id: string | null) => void;
  back: () => void;
  toggleFolder: (folder: string) => void;
  setScope: (scope: Scope) => void;
  setDepth: (depth: number) => void;
};

export const useNotesUi = create<NotesUi>()(set => ({
  camera: null,
  trail: [],
  focus: null,
  hidden: [],
  scope: "global",
  depth: 2,
  setCamera: camera => set({ camera }),
  visit: id => set(s => ({ focus: id, trail: s.trail.at(-1) === id ? s.trail : [...s.trail.filter(t => t !== id), id].slice(-TRAIL_MAX) })),
  setFocus: focus => set(s => (focus === null ? { focus, trail: [], scope: "global" } : { focus, trail: s.trail })),
  back: () => set(s => ({ trail: s.trail.slice(0, -1), focus: s.trail.at(-2) ?? null })),
  toggleFolder: folder => set(s => ({ hidden: s.hidden.includes(folder) ? s.hidden.filter(f => f !== folder) : [...s.hidden, folder] })),
  setScope: scope => set({ scope }),
  setDepth: depth => set({ depth }),
}));
