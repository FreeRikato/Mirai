import { create } from "zustand";
import type { TaskSource } from "@/shared/tasks";

export type LocalRange = { kind: "day"; date: string } | { kind: "week" } | { kind: "all" };

export type Ownership = "all" | "assigned" | "created";

export type AllRange = "today" | "week" | "all";

export type TaskRef = { source: TaskSource; id: string };

type TasksUi = {
  selected: Record<TaskSource, string | null>;
  allSelected: TaskRef | null;
  /* A card from another source opened from the priority list, shown over the current board's drawer. */
  peek: TaskRef | null;
  localRange: LocalRange;
  allRange: AllRange;
  linearOwner: Ownership;
  githubOwner: Ownership;
  select: (source: TaskSource, id: string | null) => void;
  selectAll: (ref: TaskRef | null) => void;
  setPeek: (peek: TaskRef | null) => void;
  setLocalRange: (range: LocalRange) => void;
  setAllRange: (range: AllRange) => void;
  setLinearOwner: (owner: Ownership) => void;
  setGithubOwner: (owner: Ownership) => void;
};

export const useTasksUi = create<TasksUi>()(set => ({
  selected: { local: null, linear: null, github: null },
  allSelected: null,
  peek: null,
  localRange: { kind: "week" },
  allRange: "week",
  linearOwner: "all",
  githubOwner: "all",
  /* Picking a card on the board replaces any peek, so the drawer always shows the last thing clicked. */
  select: (source, id) => set(s => ({ selected: { ...s.selected, [source]: id }, peek: null })),
  selectAll: allSelected => set({ allSelected, peek: null }),
  setPeek: peek => set({ peek }),
  setLocalRange: localRange => set({ localRange }),
  setAllRange: allRange => set({ allRange }),
  setLinearOwner: linearOwner => set({ linearOwner }),
  setGithubOwner: githubOwner => set({ githubOwner }),
}));
