import { cn } from "cn";
import type { ReactNode } from "react";
import type { Tone } from "./derive";
import { ago } from "./format";
import { useNow } from "./hooks";

export const toneClass: Record<Tone, string> = { bad: "text-bad", warn: "text-warn", fg: "text-fg", dim: "text-dim" };

export function Bar({ value, hotAt, color = "var(--color-fg)", className }: { value: number; hotAt: number; color?: string; className?: string }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className={cn("h-1 min-w-0 flex-1 bg-track", className)}>
      <div className="h-full" style={{ width: `${v}%`, background: v >= hotAt ? "var(--color-bad)" : color }} />
    </div>
  );
}

export function Heading({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <h2 className="m-0 text-[13px] font-semibold">{children}</h2>
      {right && <div className="flex flex-wrap items-baseline gap-x-5 text-[11px] whitespace-nowrap">{right}</div>}
    </div>
  );
}

export function Page({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-col gap-[22px] px-4 pt-4 pb-7 md:px-8 md:pt-5", className)}>{children}</div>;
}

export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className="flex flex-col gap-1.5">
      <h1 className="m-0 truncate text-[32px] leading-none font-bold tracking-[-0.02em] md:text-[40px]">{title}</h1>
      {children}
    </header>
  );
}

export function Ago({ at }: { at: string | number | null }) {
  return ago(at, useNow(10_000));
}

export function Pills({ items, color, label }: { items: readonly ReactNode[]; color: string; label: string }) {
  return (
    <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0" aria-label={label}>
      {items.map((item, i) => (
        <li key={i} className="rounded-full px-2.5 py-0.5" style={{ color, background: `color-mix(in srgb, ${color} 14%, transparent)` }}>
          {item}
        </li>
      ))}
    </ul>
  );
}

export const headCell = "h-auto px-0 py-1.5 font-mono text-[10px] font-normal text-dim";
export const bodyCell = "px-0 py-1.5 font-mono text-[11px]";
export const narrowOnly = "block text-[10px] text-dim @xl:hidden";

export function Row({ label, children, tone = "fg" }: { label: string; children: ReactNode; tone?: Tone }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-dim">{label}</span>
      <span className={toneClass[tone]}>{children}</span>
    </div>
  );
}

export const Swatch = ({ color, className }: { color: string; className?: string }) => (
  <span aria-hidden className={cn("inline-block h-3 w-1.5 shrink-0", className)} style={{ background: color }} />
);
