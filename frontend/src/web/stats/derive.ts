import type { LimitWindow } from "@/shared/usage";
import { duration } from "../format";

export type Pace = "ahead" | "on" | "under";

const usdFormat = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usdWhole = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export const usd = (n: number): string => (Math.abs(n) >= 10_000 ? usdWhole.format(n) : usdFormat.format(n));

const SCALES = [
  [1e9, "B"],
  [1e6, "M"],
  [1e3, "K"],
] as const;

export function tokens(n: number): string {
  for (const [size, unit] of SCALES) {
    if (n >= size) {
      const v = n / size;
      return `${v >= 100 ? Math.round(v) : v >= 10 ? v.toFixed(1).replace(/\.0$/, "") : v.toFixed(2).replace(/\.?0+$/, "")}${unit}`;
    }
  }
  return String(Math.round(n));
}

export const share = (part: number, whole: number): number => (whole > 0 ? part / whole : 0);

export const percent = (n: number): string => `${n > 0 && n < 0.01 ? "<1" : Math.round(n * 100)}%`;

export const left = (w: LimitWindow): number => Math.round(100 - w.usedPercent);

export function timeLeft(w: LimitWindow, now: number): number | null {
  if (w.resetsAt === null) return null;
  return Math.max(0, Math.min(1, (w.resetsAt - now) / w.durationMs));
}

export function paceOf(w: LimitWindow, now: number): Pace | null {
  const t = timeLeft(w, now);
  if (t === null) return null;
  const gap = w.usedPercent - (1 - t) * 100;
  return gap > 5 ? "ahead" : gap < -5 ? "under" : "on";
}

export const resetsIn = (w: LimitWindow, now: number): string | null => (w.resetsAt === null ? null : duration(Math.max(0, (w.resetsAt - now) / 1000)));

export function heatLevel(v: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (v <= 0 || max <= 0) return 0;
  const l = Math.ceil(4 * Math.sqrt(v / max));
  return l >= 4 ? 4 : l <= 1 ? 1 : l === 2 ? 2 : 3;
}

export type HeatCell = { day: string; value: number } | null;

export function weekColumns(days: readonly string[], values: readonly number[]): HeatCell[][] {
  const first = days[0];
  if (!first) return [];
  const pad = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7;
  const cells: HeatCell[] = [...Array.from({ length: pad }, () => null), ...days.map((day, i) => ({ day, value: values[i] ?? 0 }))];
  const cols: HeatCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) cols.push(Array.from({ length: 7 }, (_, j) => cells[i + j] ?? null));
  return cols;
}

export function ticks(count: number, want: number): number[] {
  if (count <= 0) return [];
  if (count <= want) return Array.from({ length: count }, (_, i) => i);
  const step = (count - 1) / (want - 1);
  return Array.from({ length: want }, (_, i) => Math.round(i * step));
}
