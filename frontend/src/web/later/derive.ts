import type { LaterItem, LaterKind, LaterState, Skip } from "@/shared/later";

export const LATER_QUEUES = ["queue", "done", "archived"] as const;
export type LaterQueue = (typeof LATER_QUEUES)[number];
export const QUEUE_LABEL: Record<LaterQueue, string> = { queue: "unread", done: "done", archived: "archived" };

export const BUDGETS = [10, 30, 60] as const;
export type Budget = (typeof BUDGETS)[number] | null;

export type LaterFilter = { kind: LaterKind; queue: LaterQueue; budget: Budget; site: string | null; text: string };

const QUEUE_STATES: Record<LaterQueue, readonly LaterState[]> = { queue: ["unread", "progress"], done: ["done"], archived: ["archived"] };

export const inQueue = (item: LaterItem, queue: LaterQueue) => item.folder === null && QUEUE_STATES[queue].includes(item.state);

export const toggledDone = (item: LaterItem): LaterState => (item.state === "done" ? "unread" : "done");

export const remainingSec = (item: LaterItem): number | null => (item.lengthSec === null ? null : Math.round(item.lengthSec * (1 - item.progress)));

export function fitsBudget(item: LaterItem, budget: Budget): boolean {
  if (budget === null) return true;
  const left = remainingSec(item);
  return left !== null && left <= budget * 60;
}

export function matches(item: LaterItem, text: string): boolean {
  const hay = `${item.title} ${item.site} ${item.author ?? ""} ${item.tldr.join(" ")}`.toLowerCase();
  return text
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every(w => hay.includes(w));
}

export function visible(items: readonly LaterItem[], f: LaterFilter): LaterItem[] {
  return items.filter(i => i.kind === f.kind && inQueue(i, f.queue) && fitsBudget(i, f.budget) && (f.site === null || i.site === f.site) && matches(i, f.text));
}

export function queueCounts(items: readonly LaterItem[], kind: LaterKind): Record<LaterQueue, number> {
  const mine = items.filter(i => i.kind === kind);
  return { queue: mine.filter(i => inQueue(i, "queue")).length, done: mine.filter(i => inQueue(i, "done")).length, archived: mine.filter(i => inQueue(i, "archived")).length };
}

export function kindCounts(items: readonly LaterItem[]): Record<LaterKind, number> {
  const open = items.filter(i => inQueue(i, "queue"));
  return { read: open.filter(i => i.kind === "read").length, watch: open.filter(i => i.kind === "watch").length };
}

export function siteCounts(items: readonly LaterItem[], kind: LaterKind, queue: LaterQueue): [string, number][] {
  const counts = new Map<string, number>();
  for (const i of items) if (i.kind === kind && inQueue(i, queue)) counts.set(i.site, (counts.get(i.site) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

export function budgetCounts(items: readonly LaterItem[], kind: LaterKind, queue: LaterQueue): Record<string, number> {
  const pool = items.filter(i => i.kind === kind && inQueue(i, queue));
  return Object.fromEntries([...BUDGETS.map(b => [String(b), pool.filter(i => fitsBudget(i, b)).length]), ["all", pool.length]]);
}

export const isStale = (item: LaterItem, now: number, staleDays: number) => item.folder === null && item.state === "unread" && now - item.savedAt > staleDays * 86_400_000;

export const folderItems = (items: readonly LaterItem[], folderId: string): LaterItem[] => items.filter(i => i.folder?.id === folderId).sort((a, b) => (a.folder?.order ?? 0) - (b.folder?.order ?? 0));

export function upNext(items: readonly LaterItem[], current: LaterItem, budget: Budget): { next: LaterItem[]; over: LaterItem[] } {
  if (current.folder) {
    const inFolder = folderItems(items, current.folder.id);
    return { next: inFolder.slice(inFolder.findIndex(i => i.id === current.id) + 1), over: [] };
  }
  const rest = items.filter(i => i.id !== current.id && i.kind === current.kind && inQueue(i, "queue"));
  if (budget === null) return { next: rest, over: [] };
  let used = remainingSec(current) ?? 0;
  const next: LaterItem[] = [];
  const over: LaterItem[] = [];
  for (const i of rest) {
    const left = remainingSec(i);
    if (left !== null && used + left <= budget * 60) {
      next.push(i);
      used += left;
    } else over.push(i);
  }
  return { next, over };
}

export type Side = "before" | "after";

export function placed(ids: readonly string[], id: string, target: string, side: Side): string[] {
  if (id === target || !ids.includes(id) || !ids.includes(target)) return [...ids];
  const rest = ids.filter(i => i !== id);
  const at = rest.indexOf(target) + (side === "after" ? 1 : 0);
  return [...rest.slice(0, at), id, ...rest.slice(at)];
}

export function step(ids: readonly string[], selected: string | null, by: 1 | -1): string | null {
  if (ids.length === 0) return null;
  const at = selected === null ? -1 : ids.indexOf(selected);
  if (at === -1) return by === 1 ? (ids[0] ?? null) : (ids[ids.length - 1] ?? null);
  return ids[Math.min(ids.length - 1, Math.max(0, at + by))] ?? null;
}

export function clockTime(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

export function lengthLabel(item: LaterItem): string {
  if (item.lengthSec === null) return item.embed.type === "pdf" ? "pdf" : "";
  return item.kind === "watch" ? clockTime(item.lengthSec) : `${Math.max(1, Math.round(item.lengthSec / 60))} min`;
}

export function leftLabel(item: LaterItem): string | null {
  const left = remainingSec(item);
  if (left === null || item.progress <= 0 || item.progress >= 1) return null;
  return item.kind === "watch" ? `${clockTime(left)} left` : `${Math.max(1, Math.round(left / 60))} min left`;
}

const URL_START = /https?:\/\//g;

export function extractUrls(text: string): string[] {
  const starts = [...text.matchAll(URL_START)].map(m => m.index);
  const urls = starts.map((at, n) => text.slice(at, starts[n + 1]).match(/^[^\s<>"']+/)?.[0]?.replace(/[.,;:!?)\]]+$/, "") ?? "");
  return [...new Set(urls.filter(u => URL.canParse(u)))];
}

export const extractUrl = (text: string): string | null => extractUrls(text)[0] ?? null;

export function fitRate(speed: number, rates: readonly number[]): number {
  return rates.filter(r => r <= speed).at(-1) ?? rates[0] ?? 1;
}

export function stepRate(speed: number, rates: readonly number[], by: 1 | -1): number {
  const at = rates.indexOf(fitRate(speed, rates));
  return rates[Math.min(rates.length - 1, Math.max(0, at + by))] ?? speed;
}

const PLAYING_JUMP_SEC = 3;

export function skipAt(skips: readonly Skip[], prev: number, now: number): Skip | null {
  const played = now > prev && now - prev < PLAYING_JUMP_SEC;
  if (!played) return null;
  return skips.find(s => now >= s.start && now < s.end && prev <= s.start + 0.5) ?? null;
}

export const YOUTUBE_MAX_RATE = 2;

export function rateFor(item: LaterItem, speed: number): number {
  if (item.kind !== "watch") return 1;
  if (item.embed.type === "youtube") return Math.min(speed, YOUTUBE_MAX_RATE);
  return item.embed.type === "video" ? speed : 1;
}

export function timeLeft(items: readonly LaterItem[], speed: number): { sec: number; atSpeed: number; rate: number } {
  const left = items.map(i => ({ sec: (i.lengthSec ?? 0) * (1 - i.progress), rate: rateFor(i, speed) }));
  return {
    sec: left.reduce((sum, l) => sum + l.sec, 0),
    atSpeed: left.reduce((sum, l) => sum + l.sec / l.rate, 0),
    rate: Math.max(1, ...left.filter(l => l.sec > 0).map(l => l.rate)),
  };
}
