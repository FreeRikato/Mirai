import type { Flag, Svc } from "@/shared/projects";

export const FLAG_TEXT: Record<Flag, string> = { "cwd-deleted": "folder deleted", "no-worktree": "no worktree", "double-bind": "port bound twice" };

export const ports = (s: Svc): string => s.ports.map(p => `:${p}`).join(" ");

export const tint = (color: string, pct: number): string => `color-mix(in srgb, ${color} ${pct}%, transparent)`;

export function svcTitle(s: Svc): string {
  return [`${s.name} ${ports(s)}`, s.host, s.detail, ...s.flags.map(f => FLAG_TEXT[f])].filter(Boolean).join("\n");
}
