import type { LocalTask } from "@/shared/tasks";
import type { LocalRange } from "../store";

const DAY_MS = 86_400_000;
const toTime = (date: string) => Date.parse(`${date}T00:00:00Z`);
const toDate = (t: number) => new Date(t).toISOString().slice(0, 10);

export function weekOf(date: string): { from: string; to: string } {
  const t = toTime(date);
  const sinceMonday = (new Date(t).getUTCDay() + 6) % 7;
  const monday = t - sinceMonday * DAY_MS;
  return { from: toDate(monday), to: toDate(monday + 6 * DAY_MS) };
}

export function inRange(date: string, range: LocalRange, today: string): boolean {
  switch (range.kind) {
    case "all":
      return true;
    case "day":
      return date === range.date;
    case "week": {
      const w = weekOf(today);
      return date >= w.from && date <= w.to;
    }
  }
}

export const ageDays = (date: string, today: string) => Math.round((toTime(today) - toTime(date)) / DAY_MS);

export const carryable = (tasks: readonly LocalTask[], today: string, carryDays: number) =>
  tasks.filter(t => (t.state === "open" || t.state === "doing") && t.date < today && ageDays(t.date, today) <= carryDays).length;

export function monthGrid(year: number, month: number): (string | null)[][] {
  const first = Date.UTC(year, month - 1, 1);
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const lead = (new Date(first).getUTCDay() + 6) % 7;
  const cells: (string | null)[] = [...Array<null>(lead).fill(null), ...Array.from({ length: days }, (_, i) => toDate(first + i * DAY_MS))];
  while (cells.length % 7 !== 0) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));
}

const part = (t: number, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(undefined, { ...opts, timeZone: "UTC" }).format(t).toLowerCase();
export const weekdayOf = (date: string) => part(toTime(date), { weekday: "short" });
export const shortDay = (date: string) => `${weekdayOf(date)} ${Number(date.slice(8))}`;
export const monthLabel = (year: number, month: number) => `${part(Date.UTC(year, month - 1, 1), { month: "short" })} ${year}`;
