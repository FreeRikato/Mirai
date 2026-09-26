import { create } from "zustand";
import { parseCiteHref, itemHref } from "@/shared/cite";

export type Jump = { id: string; at: number } | { id: string; quote: string };

type JumpState = { jump: Jump | null; setJump: (jump: Jump | null) => void };

export const useJump = create<JumpState>()(set => ({ jump: null, setJump: jump => set({ jump }) }));

export function jumpOf(id: string, search: string): Jump | null {
  const target = parseCiteHref(`${itemHref(id)}${search}`)?.target;
  if (target?.kind === "moment") return { id, at: target.at };
  if (target?.kind === "passage") return { id, quote: target.quote };
  return null;
}
