import { create } from "zustand";
import type { ShipQueue, ShipState } from "@/shared/ship";

type ShipUi = {
  selected: string | null;
  text: Record<ShipQueue, string>;
  state: ShipState | null;
  hiddenRepos: readonly string[];
  select: (id: string | null) => void;
  reveal: (id: string, repo: string) => void;
  setText: (queue: ShipQueue, text: string) => void;
  setState: (state: ShipState | null) => void;
  toggleRepo: (repo: string) => void;
};

export const useShipUi = create<ShipUi>()(set => ({
  selected: null,
  text: { mine: "", review: "", all: "" },
  state: null,
  hiddenRepos: [],
  select: selected => set({ selected }),
  reveal: (id, repo) => set(s => ({ selected: id, state: null, text: { ...s.text, mine: "" }, hiddenRepos: s.hiddenRepos.filter(r => r !== repo) })),
  setText: (queue, text) => set(s => ({ text: { ...s.text, [queue]: text } })),
  setState: state => set({ state }),
  toggleRepo: repo => set(s => ({ hiddenRepos: s.hiddenRepos.includes(repo) ? s.hiddenRepos.filter(r => r !== repo) : [...s.hiddenRepos, repo] })),
}));
