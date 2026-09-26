import type { MiraiEvent, ToolCall } from "@/shared/mirai";
import type { Route } from "../router";
import type { OpenContent } from "../store";

export type LiveTurn = {
  threadId: string | null;
  question: string;
  view: string;
  askedAt: number;
  thinking: string;
  calls: ToolCall[];
  answer: string;
  retry: string | null;
  error: string | null;
};

export const startTurn = (threadId: string | null, question: string, view: string, askedAt: number): LiveTurn => ({
  threadId,
  question,
  view,
  askedAt,
  thinking: "",
  calls: [],
  answer: "",
  retry: null,
  error: null,
});

export function applyEvent(turn: LiveTurn, e: MiraiEvent): LiveTurn {
  switch (e.type) {
    case "thread":
      return { ...turn, threadId: e.threadId };
    case "thinking":
      return { ...turn, thinking: turn.thinking + e.delta, retry: null };
    case "text":
      return { ...turn, answer: turn.answer + e.delta, retry: null };
    case "call":
      return { ...turn, calls: [...turn.calls, { id: e.id, label: e.label, change: e.change, ok: null }] };
    case "call_end":
      return { ...turn, calls: turn.calls.map(r => (r.id === e.id ? { ...r, ok: e.ok } : r)) };
    case "retry":
      return { ...turn, answer: "", retry: `${e.error} · retrying ${e.attempt}/${e.max} in ${Math.round(e.delayMs / 1000)}s` };
    case "error":
      return { ...turn, error: e.message };
    case "done":
      return turn;
  }
}

export function splitRecords(buffer: string): { records: string[]; rest: string } {
  const parts = buffer.split("\n");
  const rest = parts.pop() ?? "";
  return { records: parts.map(p => p.replace(/\r$/, "")).filter(p => p.length > 0), rest };
}

export function sinceLabel(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

export const spentSince = (spend: readonly { at: number; costUsd: number }[], since: number): number => spend.reduce((sum, s) => (s.at >= since ? sum + s.costUsd : sum), 0);

export const costLabel = (usd: number): string => (usd < 0.005 ? `$${usd.toFixed(3)}` : `$${usd.toFixed(2)}`);

const VIEW_MAX = 120;

const clipTitle = (title: string) => (title.length > 48 ? `${title.slice(0, 47)}…` : title);

function fullViewLabel(route: Route, item: OpenContent | null): string {
  switch (route.module) {
    case "machines":
      return route.host ? `${route.host} / host` : "fleet";
    case "tasks":
      return `tasks / ${route.board}`;
    case "ship":
      return route.review ? `ship / ${route.review}` : `ship / ${route.queue}`;
    case "later": {
      const v = route.view;
      const base = v.by === "kind" ? `content / ${v.kind}` : v.by === "folder" ? `content / folder ${v.folder}` : `content / ${item?.kind ?? "item"}`;
      return item ? `${base} · ${item.id} · ${clipTitle(item.title)}` : base;
    }
    case "notes":
      return route.target ? `notes / ${route.target}` : "notes";
    case "projects":
      return `projects / ${route.view}`;
    case "stats":
      return "stats";
  }
}

export const viewLabel = (route: Route, item: OpenContent | null = null): string => fullViewLabel(route, item).slice(0, VIEW_MAX);
