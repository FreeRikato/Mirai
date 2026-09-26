import { LATER_KINDS } from "@/shared/later";
import { SHIP_QUEUES, type ShipQueue } from "@/shared/ship";
import { TASK_BOARDS, type TaskBoard } from "@/shared/tasks";
import { useFleetSlice } from "../api";
import { useVault } from "../notes/api";
import { hrefFor, laterHref, notesHref, shipHref, tasksHref } from "../router";
import { useSettings } from "../settings";

export type PageGroup = "machines" | "tasks" | "ship" | "later" | "notes" | "stats";

export type Page = { href: string; group: PageGroup; label: string; hint: string; keywords: readonly string[]; color?: string };

const TASK_PAGES: Record<TaskBoard, { label: string; keywords: readonly string[] }> = {
  all: { label: "all tasks", keywords: ["everything", "combined", "every source"] },
  local: { label: "daily notes", keywords: ["local", "obsidian", "todo", "today", "priority"] },
  linear: { label: "linear", keywords: ["tickets", "issues", "cycle"] },
  github: { label: "github issues", keywords: ["issues", "gh"] },
};

const SHIP_PAGES: Record<ShipQueue, { keywords: readonly string[] }> = {
  mine: { keywords: ["my prs", "pull requests", "prs", "authored", "ready", "blocked"] },
  review: { keywords: ["review", "reviews", "requested", "re-review", "prs"] },
  all: { keywords: ["search", "org", "all prs", "pull requests"] },
};

export function usePages(): Page[] {
  const { data: machines = [] } = useFleetSlice(fleet => fleet?.machines.map(m => ({ name: m.ts.name, ip: m.ts.ip, kind: m.kind, color: m.color })) ?? []);
  const org = useSettings().ship.org;
  const { vault } = useVault();
  const shipLabel: Record<ShipQueue, string> = { mine: "my prs", review: "waiting on you", all: "all prs" };

  return [
    { href: hrefFor(null), group: "machines", label: "fleet", hint: "/machines", keywords: ["machines", "mesh", "tailnet", "home"] },
    ...machines.map(m => ({
      href: hrefFor(m.name),
      group: "machines" as const,
      label: m.name,
      hint: m.kind === "live" ? m.ip : m.kind,
      keywords: ["machine", "host", m.ip],
      color: m.color,
    })),
    ...TASK_BOARDS.map(s => ({ href: tasksHref(s), group: "tasks" as const, label: TASK_PAGES[s].label, hint: tasksHref(s), keywords: ["tasks", ...TASK_PAGES[s].keywords] })),
    ...SHIP_QUEUES.map(q => ({ href: shipHref(q), group: "ship" as const, label: shipLabel[q], hint: shipHref(q), keywords: ["ship", ...SHIP_PAGES[q].keywords, ...(q === "all" && org ? [org] : [])] })),
    ...LATER_KINDS.map(k => ({ href: laterHref(k), group: "later" as const, label: `${k} content`, hint: laterHref(k), keywords: ["content", "later", "saved", k === "read" ? "articles" : "videos", k === "read" ? "reading" : "youtube"] })),
    { href: notesHref(null), group: "notes", label: "graph", hint: "/notes", keywords: ["notes", "obsidian", "vault", "graph", "knowledge"] },
    { href: "/stats", group: "stats", label: "ai usage", hint: "/stats", keywords: ["stats", "claude", "codex", "limits", "cost", "tokens", "usage"] },
    ...(vault?.notes ?? []).map(n => ({ href: notesHref(n.id), group: "notes" as const, label: n.title, hint: n.folder || "vault", keywords: ["note", ...n.id.split("/").slice(0, -1)] })),
  ];
}
