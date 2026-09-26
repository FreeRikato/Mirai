import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { Metric, Period } from "@/shared/usage";

type StatsUi = {
  metric: Metric;
  period: Period;
  hidden: string[];
  setMetric: (metric: Metric) => void;
  setPeriod: (period: Period) => void;
  toggleMachine: (name: string) => void;
};

export const useStatsUi = create<StatsUi>()(
  persist(
    set => ({
      metric: "cost",
      period: "30d",
      hidden: [],
      setMetric: metric => set({ metric }),
      setPeriod: period => set({ period }),
      toggleMachine: name => set(s => ({ hidden: s.hidden.includes(name) ? s.hidden.filter(h => h !== name) : [...s.hidden, name] })),
    }),
    { name: "mirai-stats", storage: createJSONStorage(() => localStorage) },
  ),
);
