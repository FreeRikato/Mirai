import { expect, test } from "bun:test";
import type { LocalTask } from "@/shared/tasks";
import { ageDays, carryable, inRange, monthGrid, weekOf } from "./derive";

const task = (date: string, state: LocalTask["state"]): LocalTask => ({ id: date, date, line: 0, state, title: "", raw: "", links: [], subtasks: { done: 0, total: 0 }, block: "" });

test("a week runs Monday to Sunday", () => {
  expect(weekOf("2026-09-24")).toEqual({ from: "2026-09-21", to: "2026-09-27" });
  expect(weekOf("2026-09-21")).toEqual({ from: "2026-09-21", to: "2026-09-27" });
  expect(weekOf("2026-09-27")).toEqual({ from: "2026-09-21", to: "2026-09-27" });
});

test("ranges pick a day, the current week or everything", () => {
  expect(inRange("2026-09-20", { kind: "week" }, "2026-09-24")).toBe(false);
  expect(inRange("2026-09-21", { kind: "week" }, "2026-09-24")).toBe(true);
  expect(inRange("2026-09-22", { kind: "day", date: "2026-09-22" }, "2026-09-24")).toBe(true);
  expect(inRange("2020-01-01", { kind: "all" }, "2026-09-24")).toBe(true);
});

test("age counts whole days from the note to today", () => {
  expect(ageDays("2026-09-22", "2026-09-24")).toBe(2);
});

test("only last week's unfinished work is offered for carrying, as the hub does it", () => {
  expect(carryable([task("2026-09-23", "open"), task("2026-09-22", "doing"), task("2026-09-22", "done"), task("2026-09-10", "open"), task("2026-09-24", "open")], "2026-09-24", 7)).toBe(2);
});

test("the month grid starts on Monday and pads with nulls", () => {
  const grid = monthGrid(2026, 9);
  expect(grid[0]).toEqual([null, "2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05", "2026-09-06"]);
  expect(grid.at(-1)).toEqual(["2026-09-28", "2026-09-29", "2026-09-30", null, null, null, null]);
});
