import { and, gte, lt, sql } from "drizzle-orm";
import type { LoadRange, LoadStrip } from "@/shared/schema";
import type { Db } from "./db";
import { samples } from "./db/schema";

export const SAMPLE_MS = 60_000;

const RANGE_MS: Record<LoadRange, number> = { "1h": 60 * 60_000, "24h": 24 * 60 * 60_000, "7d": 7 * 24 * 60 * 60_000 };
const BUCKETS: Record<LoadRange, number> = { "1h": 60, "24h": 96, "7d": 96 };

export const isLoadRange = (v: string | null): v is LoadRange => v === "1h" || v === "24h" || v === "7d";

export function loadStrip(db: Db, range: LoadRange, now = Date.now()): LoadStrip {
  const buckets = BUCKETS[range];
  const size = RANGE_MS[range] / buckets;
  const end = Math.floor((now - SAMPLE_MS) / size) * size + size;
  const start = end - buckets * size;
  const bucket = sql<number>`cast((${samples.at} - ${start}) / ${size} as integer)`;
  const rows = db
    .select({ machine: samples.machine, bucket, cpu: sql<number>`avg(${samples.cpu})` })
    .from(samples)
    .where(and(gte(samples.at, start), lt(samples.at, end)))
    .groupBy(samples.machine, bucket)
    .all();
  const byMachine = new Map<string, (number | null)[]>();
  for (const r of rows) {
    const values = byMachine.get(r.machine) ?? Array<number | null>(buckets).fill(null);
    if (r.bucket >= 0 && r.bucket < buckets) values[r.bucket] = r.cpu;
    byMachine.set(r.machine, values);
  }
  return { range, buckets, rows: [...byMachine].map(([machine, values]) => ({ machine, values })) };
}
