import type { TokenLine } from "@/shared/code";

export type Segment = { start: number; text: string; color: string | null };

export function segments(text: string, tokens: TokenLine | null): Segment[] {
  if (tokens === null || tokens.map(([t]) => t).join("") !== text) return text ? [{ start: 0, text, color: null }] : [];
  const out: Segment[] = [];
  let at = 0;
  for (const [t, color] of tokens) {
    if (t) out.push({ start: at, text: t, color });
    at += t.length;
  }
  return out;
}
