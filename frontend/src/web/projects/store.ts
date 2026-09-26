import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

type ProjectsUi = {
  hidden: string[];
  tools: boolean;
  toggleHost: (name: string) => void;
  setTools: (tools: boolean) => void;
};

export const useProjectsUi = create<ProjectsUi>()(
  persist(
    set => ({
      hidden: [],
      tools: false,
      toggleHost: name => set(s => ({ hidden: s.hidden.includes(name) ? s.hidden.filter(h => h !== name) : [...s.hidden, name] })),
      setTools: tools => set({ tools }),
    }),
    { name: "mirai-projects", storage: createJSONStorage(() => localStorage) },
  ),
);
