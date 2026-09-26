import type { Tone } from "./derive";

export const toneText: Record<Tone, string> = { ok: "text-ok", bad: "text-bad", warn: "text-warn", fg: "text-fg", dim: "text-dim", faint: "text-faint", link: "text-link" };
export const toneDot: Record<Tone, string> = { ok: "bg-ok", bad: "bg-bad", warn: "bg-warn", fg: "bg-fg", dim: "bg-dim", faint: "bg-faint", link: "bg-link" };
