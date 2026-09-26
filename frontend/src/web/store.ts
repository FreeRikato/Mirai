import { create } from "zustand";
import type { LaterKind } from "@/shared/later";
import type { LoadRange } from "@/shared/schema";

export type ProcessTab = "cpu" | "memory" | "ports";

export type OpenContent = { id: string; title: string; kind: LaterKind };

type UiState = {
  navOpen: boolean;
  mirAIOpen: boolean;
  mirAIDraft: string;
  openContent: OpenContent | null;
  mirAIBack: boolean;
  lastCite: string | null;
  citeClicks: number;
  paletteOpen: boolean;
  loadRange: LoadRange;
  processTab: ProcessTab;
  setNavOpen: (open: boolean) => void;
  setMirAIOpen: (open: boolean) => void;
  askMirAI: (question: string) => void;
  setPaletteOpen: (open: boolean) => void;
  setLoadRange: (range: LoadRange) => void;
  setProcessTab: (tab: ProcessTab) => void;
};

export const useUi = create<UiState>()(set => ({
  navOpen: false,
  mirAIOpen: false,
  mirAIDraft: "",
  openContent: null,
  mirAIBack: false,
  lastCite: null,
  citeClicks: 0,
  paletteOpen: false,
  loadRange: "24h",
  processTab: "cpu",
  setNavOpen: navOpen => set({ navOpen }),
  setMirAIOpen: mirAIOpen => set(mirAIOpen ? { mirAIOpen, mirAIBack: false } : { mirAIOpen }),
  askMirAI: mirAIDraft => set({ mirAIDraft, mirAIOpen: true, paletteOpen: false }),
  setPaletteOpen: paletteOpen => set({ paletteOpen }),
  setLoadRange: loadRange => set({ loadRange }),
  setProcessTab: processTab => set({ processTab }),
}));
