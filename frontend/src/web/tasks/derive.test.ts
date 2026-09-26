import { expect, test } from "bun:test";
import { closedPerDay, countBy, currentCycle, owned, ownershipCounts } from "./derive";

const who = (a: boolean, c: boolean) => ({ assigned: a, created: c });
const items = [who(true, false), who(true, true), who(false, true), who(false, false)];

test("ownership filters count an issue that is both assigned and created once in 'all'", () => {
  expect(owned(items, "all", x => x)).toHaveLength(3);
  expect(owned(items, "assigned", x => x)).toHaveLength(2);
  expect(owned(items, "created", x => x)).toHaveLength(2);
  expect(ownershipCounts(items, x => x)).toEqual({ all: 3, assigned: 2, created: 2, both: 1 });
});

test("counts group by key in first-seen order", () => {
  expect(countBy(["b", "a", "b"], x => x)).toEqual([
    ["b", 2],
    ["a", 1],
  ]);
});

test("the current cycle is the soonest-ending one that has not ended", () => {
  const now = Date.parse("2026-09-24T00:00:00Z");
  const cycle = (n: number, endsAt: string) => ({ cycle: { number: n, endsAt } });
  expect(currentCycle([cycle(37, "2026-09-19T00:00:00Z"), cycle(39, "2026-10-10T00:00:00Z"), cycle(38, "2026-09-26T00:00:00Z"), { cycle: null }], now)?.number).toBe(38);
  expect(currentCycle([{ cycle: null }], now)).toBeNull();
});

test("closed per day covers the last seven days, oldest first, zeros included", () => {
  const now = Date.parse("2026-09-24T12:00:00Z");
  const out = closedPerDay(["2026-09-24T01:00:00Z", "2026-09-24T02:00:00Z", "2026-09-20T09:00:00Z", "2026-09-01T00:00:00Z"], now);
  expect(out.map(d => d.count)).toEqual([0, 0, 1, 0, 0, 0, 2]);
  expect(out.at(-1)?.date).toBe("2026-09-24");
});
