import type { Ownership } from "./store";

type Who = { assigned: boolean; created: boolean };

export function owned<T>(items: readonly T[], owner: Ownership, who: (t: T) => Who): T[] {
  return items.filter(t => {
    const w = who(t);
    return owner === "assigned" ? w.assigned : owner === "created" ? w.created : w.assigned || w.created;
  });
}

export function ownershipCounts<T>(items: readonly T[], who: (t: T) => Who) {
  const ws = items.map(who);
  return {
    all: ws.filter(w => w.assigned || w.created).length,
    assigned: ws.filter(w => w.assigned).length,
    created: ws.filter(w => w.created).length,
    both: ws.filter(w => w.assigned && w.created).length,
  };
}

export function countBy<T>(items: readonly T[], key: (t: T) => string): [string, number][] {
  const out = new Map<string, number>();
  for (const t of items) out.set(key(t), (out.get(key(t)) ?? 0) + 1);
  return [...out];
}

type Cycle = { number: number; endsAt: string };

export function currentCycle(items: readonly { cycle: Cycle | null }[], now = Date.now()): Cycle | null {
  const live = items.flatMap(i => (i.cycle && Date.parse(i.cycle.endsAt) > now ? [i.cycle] : []));
  return live.toSorted((a, b) => Date.parse(a.endsAt) - Date.parse(b.endsAt))[0] ?? null;
}

export function closedPerDay(closedAt: readonly string[], now = Date.now()): { date: string; count: number }[] {
  const days = Array.from({ length: 7 }, (_, i) => new Date(now - (6 - i) * 86_400_000).toISOString().slice(0, 10));
  return days.map(date => ({ date, count: closedAt.filter(c => c.slice(0, 10) === date).length }));
}
