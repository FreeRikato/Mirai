import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { DraftComment, Verdict } from "@/shared/ship";

export type Draft = { comments: DraftComment[]; body: string; verdict: Verdict };
export type DiffMode = "split" | "unified";

const EMPTY: Draft = { comments: [], body: "", verdict: "comment" };

type Drafts = {
  drafts: Record<string, Draft>;
  mode: DiffMode;
  colours: boolean;
  addComment: (id: string, comment: DraftComment) => void;
  removeComment: (id: string, comment: DraftComment) => void;
  setBody: (id: string, body: string) => void;
  setVerdict: (id: string, verdict: Verdict) => void;
  clear: (id: string) => void;
  setMode: (mode: DiffMode) => void;
  setColours: (colours: boolean) => void;
};

export const useDrafts = create<Drafts>()(
  persist(
    set => {
      const edit = (id: string, change: (d: Draft) => Partial<Draft>) =>
        set(s => {
          const current = s.drafts[id] ?? EMPTY;
          return { drafts: { ...s.drafts, [id]: { ...current, ...change(current) } } };
        });
      return {
        drafts: {},
        mode: "split",
        colours: false,
        addComment: (id, comment) => edit(id, d => ({ comments: [...d.comments, comment] })),
        removeComment: (id, comment) => edit(id, d => ({ comments: d.comments.filter(c => c !== comment) })),
        setBody: (id, body) => edit(id, () => ({ body })),
        setVerdict: (id, verdict) => edit(id, () => ({ verdict })),
        clear: id =>
          set(s => {
            const { [id]: _, ...rest } = s.drafts;
            return { drafts: rest };
          }),
        setMode: mode => set({ mode }),
        setColours: colours => set({ colours }),
      };
    },
    { name: "mirai-review-drafts", storage: createJSONStorage(() => localStorage), partialize: s => ({ drafts: s.drafts, mode: s.mode, colours: s.colours }) },
  ),
);

export const useDraft = (id: string): Draft => useDrafts(s => s.drafts[id] ?? EMPTY);
