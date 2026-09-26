import { eq } from "drizzle-orm";
import { z } from "zod";
import type { RankingSnapshot } from "@/shared/ranking";
import type { Db } from "./db";
import { priorityRankings } from "./db/schema";
import type { Jev, JevAnswer, JevQuestion } from "./jev";

export type Keyed<T> = { key: string; item: T };

export type Asking<T, R> = {
  state: (keyed: readonly Keyed<T>[]) => unknown;
  questions: (key: string) => Record<string, JevQuestion>;
  read: (answers: Readonly<Record<string, JevAnswer>>, keyed: Keyed<T>) => R | null;
};

export async function askInBatches<T, R>(jev: Jev, items: readonly T[], batch: number, asking: Asking<T, R>): Promise<{ results: R[]; costUsd: number }> {
  const chunks = Array.from({ length: Math.ceil(items.length / batch) }, (_, i) => items.slice(i * batch, (i + 1) * batch));
  const answered = await Promise.all(
    chunks.map(async (chunk, c) => {
      const keyed = chunk.map((item, i) => ({ key: `item_${c * batch + i}`, item }));
      const questions = Object.assign({}, ...keyed.map(({ key }) => asking.questions(key)));
      const { answers, costUsd } = await jev(asking.state(keyed), questions);
      return { results: keyed.flatMap(k => asking.read(answers, k) ?? []), costUsd };
    }),
  );
  return { results: answered.flatMap(a => a.results), costUsd: answered.reduce((sum, a) => sum + a.costUsd, 0) };
}

export const RANKING_ROWS = { priority: 1, mergeReadiness: 2, laterRead: 3, laterWatch: 4 } as const;
export type RankingRow = (typeof RANKING_ROWS)[keyof typeof RANKING_ROWS];

export type SavedRanking<I> = { ranked: I[]; rankedAt: number; costUsd: number };

export function createRankingStore<I>(db: Db, row: RankingRow, item: z.ZodType<I>) {
  const items = z.array(item);

  function load(): SavedRanking<I> | null {
    const saved = db.select().from(priorityRankings).where(eq(priorityRankings.id, row)).get();
    if (!saved) return null;
    const parsed = items.safeParse(JSON.parse(saved.items));
    if (!parsed.success) {
      console.warn(`ranking ${row}: ignoring a saved ranking that no longer parses`, parsed.error.message);
      return null;
    }
    return { ranked: parsed.data, rankedAt: saved.rankedAt, costUsd: saved.costUsd };
  }

  function save({ ranked, rankedAt, costUsd }: SavedRanking<I>) {
    const values = { rankedAt, costUsd, items: JSON.stringify(ranked) };
    db.insert(priorityRankings).values({ id: row, ...values }).onConflictDoUpdate({ target: priorityRankings.id, set: values }).run();
  }

  return { load, save };
}

export type RankingStore<I> = ReturnType<typeof createRankingStore<I>>;

export type RankerDeps<I> = {
  jev: Jev | null;
  missingJev: string;
  saved: RankingStore<I>;
  live: () => Promise<ReadonlySet<string>>;
  rank: (jev: Jev) => Promise<{ ranked: I[]; costUsd: number }>;
  keyOf: (item: I) => string;
  shown: number;
};

type Outcome<I> = ({ ok: true } & SavedRanking<I>) | { ok: false; reason: string };

const reasonOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function createRanker<I>(deps: RankerDeps<I>) {
  const saved = deps.saved.load();
  let last: Outcome<I> | null = saved && { ok: true, ...saved };
  let inFlight: Promise<Outcome<I>> | null = null;

  async function rankNow(jev: Jev): Promise<Outcome<I>> {
    try {
      const ranking = { ...(await deps.rank(jev)), rankedAt: Date.now() };
      deps.saved.save(ranking);
      return { ok: true, ...ranking };
    } catch (err: unknown) {
      return { ok: false, reason: reasonOf(err) };
    }
  }

  async function snapshot(): Promise<RankingSnapshot<I>> {
    if (!deps.jev) return { kind: "unavailable", reason: deps.missingJev };
    if (!last) return { kind: "unranked" };
    if (!last.ok) return { kind: "unavailable", reason: last.reason };
    try {
      const live = await deps.live();
      const still = last.ranked.filter(r => live.has(deps.keyOf(r)));
      return { kind: "ready", items: still.slice(0, deps.shown), more: Math.max(0, still.length - deps.shown), unranked: live.size - still.length, rankedAt: last.rankedAt, costUsd: last.costUsd };
    } catch (err: unknown) {
      return { kind: "unavailable", reason: reasonOf(err) };
    }
  }

  async function refresh(): Promise<RankingSnapshot<I>> {
    const { jev } = deps;
    if (jev) {
      inFlight ??= rankNow(jev).finally(() => {
        inFlight = null;
      });
      last = await inFlight;
    }
    return snapshot();
  }

  return { snapshot, refresh };
}
