import { expect, test } from "bun:test";
import { openDb } from "./db";
import { samples } from "./db/schema";
import { loadStrip, SAMPLE_MS } from "./history";

const minuteAt = (t: number) => Math.floor(t / SAMPLE_MS) * SAMPLE_MS;

test("1h has one bucket per minute, so a machine sampled every minute has no holes", () => {
  const db = openDb(":memory:");
  const now = 24 * 60 * 60_000 * 10 + 42_000;
  const rows = Array.from({ length: 90 }, (_, i) => ({ machine: "archikato", at: minuteAt(now) - i * SAMPLE_MS, cpu: 3, mem: 0 }));
  db.insert(samples).values(rows).run();
  const values = loadStrip(db, "1h", now).rows[0]?.values ?? [];
  expect(values).toHaveLength(60);
  expect(values.every(v => v === 3)).toBe(true);
});

test("buckets average their samples and stay null where the hub recorded nothing", () => {
  const db = openDb(":memory:");
  const now = 24 * 60 * 60_000 * 10;
  const bucketMs = (24 * 60 * 60_000) / 96;
  const start = now - 96 * bucketMs;
  db.insert(samples).values([
    { machine: "omarikato", at: start, cpu: 20, mem: 0 },
    { machine: "omarikato", at: start + SAMPLE_MS, cpu: 40, mem: 0 },
    { machine: "omarikato", at: now - bucketMs, cpu: 90, mem: 0 },
    { machine: "omarikato", at: start - SAMPLE_MS, cpu: 99, mem: 0 },
  ]).run();
  const values = loadStrip(db, "24h", now).rows[0]?.values ?? [];
  expect(values).toHaveLength(96);
  expect(values[0]).toBe(30);
  expect(values[95]).toBe(90);
  expect(values.filter(v => v !== null)).toHaveLength(2);
});
