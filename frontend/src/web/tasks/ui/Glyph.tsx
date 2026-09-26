import { cn } from "cn";
import { Circle, CircleCheck, CircleDot, CircleSlash, Contrast, type LucideIcon } from "lucide-react";

export type Glyph = "open" | "doing" | "review" | "done" | "dropped";

const GLYPHS: Record<Glyph, { icon: LucideIcon; tone: string }> = {
  open: { icon: Circle, tone: "text-fg" },
  doing: { icon: Contrast, tone: "text-warn" },
  review: { icon: CircleDot, tone: "text-link" },
  done: { icon: CircleCheck, tone: "text-ok" },
  dropped: { icon: CircleSlash, tone: "text-dim" },
};

export function GlyphIcon({ glyph, className }: { glyph: Glyph; className?: string }) {
  const { icon: Icon, tone } = GLYPHS[glyph];
  return <Icon aria-hidden className={cn("size-3.5 shrink-0", tone, className)} />;
}
