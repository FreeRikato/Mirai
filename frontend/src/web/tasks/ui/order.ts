export type DropTarget = { key: string; after: boolean };

export function sortByOrder<T>(items: readonly T[], rankOf: (item: T) => string, order: readonly string[]): T[] {
  const at = new Map(order.map((k, i) => [k, i]));
  return items
    .map((item, i) => ({ item, i, rank: at.get(rankOf(item)) ?? -1 }))
    .toSorted((a, b) => a.rank - b.rank || a.i - b.i)
    .map(x => x.item);
}

export function place(order: readonly string[], shown: readonly string[], active: string, target: DropTarget | null): string[] {
  const saved = new Set(order);
  const base = [...new Set([...shown.filter(k => !saved.has(k)), ...order])].filter(k => k !== active);
  const at = target ? base.indexOf(target.key) : -1;
  const i = target && at !== -1 ? at + (target.after ? 1 : 0) : base.length;
  return base.toSpliced(i, 0, active);
}
