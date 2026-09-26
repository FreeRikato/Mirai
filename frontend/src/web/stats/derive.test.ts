import { expect, test } from "bun:test";
import type { LimitWindow } from "@/shared/usage";
import { heatLevel, paceOf, percent, resetsIn, ticks, timeLeft, tokens, usd, weekColumns } from "./derive";

const HOUR = 3_600_000;
const win = (usedPercent: number, hoursLeft: number): LimitWindow => ({ id: "w", label: "session", usedPercent, resetsAt: 1_000 * HOUR + hoursLeft * HOUR, durationMs: 5 * HOUR });
const now = 1_000 * HOUR;

test("pace compares quota used with time used, with five points of slack", () => {
  expect(paceOf(win(80, 2.5), now)).toBe("ahead");
  expect(paceOf(win(52, 2.5), now)).toBe("on");
  expect(paceOf(win(20, 2.5), now)).toBe("under");
  expect(paceOf({ ...win(20, 1), resetsAt: null }, now)).toBeNull();
  expect(timeLeft(win(0, 1), now)).toBeCloseTo(0.2, 10);
  expect(resetsIn(win(0, 2.1), now)).toBe("2h 06m");
});

test("money and token counts read at a glance", () => {
  expect(usd(1284.6)).toBe("$1,284.60");
  expect(usd(12_840)).toBe("$12,840");
  expect(tokens(1_920_000_000)).toBe("1.92B");
  expect(tokens(214_000_000)).toBe("214M");
  expect(tokens(96_100_000)).toBe("96.1M");
  expect(tokens(1_000)).toBe("1K");
  expect(tokens(512)).toBe("512");
  expect(percent(0.004)).toBe("<1%");
  expect(percent(0.52)).toBe("52%");
});

test("the heatmap starts each column on monday and pads the first week", () => {
  const cols = weekColumns(["2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27", "2026-09-28"], [1, 2, 3, 4, 5]);
  expect(cols).toHaveLength(2);
  expect(cols[0]?.slice(0, 3)).toEqual([null, null, null]);
  expect(cols[0]?.[3]).toEqual({ day: "2026-09-24", value: 1 });
  expect(cols[1]?.[0]).toEqual({ day: "2026-09-28", value: 5 });
  expect(heatLevel(0, 10)).toBe(0);
  expect(heatLevel(0.1, 10)).toBe(1);
  expect(heatLevel(10, 10)).toBe(4);
});

test("axis ticks spread evenly and always include both ends", () => {
  expect(ticks(30, 6)).toEqual([0, 6, 12, 17, 23, 29]);
  expect(ticks(3, 6)).toEqual([0, 1, 2]);
});
