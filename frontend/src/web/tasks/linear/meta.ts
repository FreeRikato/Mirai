import { Minus, SignalHigh, SignalLow, SignalMedium, TriangleAlert, type LucideIcon } from "lucide-react";
import type { LinearColumn, LinearIssue, LinearPriority } from "@/shared/tasks";
import type { Glyph } from "../ui/Glyph";

export const linearGlyph: Record<LinearColumn, Glyph> = { todo: "open", progress: "doing", review: "review", done: "done" };

export const PRIORITY: Record<LinearPriority, { icon: LucideIcon; tone: string }> = {
  urgent: { icon: TriangleAlert, tone: "text-bad" },
  high: { icon: SignalHigh, tone: "text-fg" },
  medium: { icon: SignalMedium, tone: "text-fg" },
  low: { icon: SignalLow, tone: "text-dim" },
  none: { icon: Minus, tone: "text-dim" },
};

export const who = (i: LinearIssue) => ({ assigned: i.assignee?.isMe === true, created: i.creator?.isMe === true });
