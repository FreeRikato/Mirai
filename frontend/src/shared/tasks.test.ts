import { expect, test } from "bun:test";
import { LocalBlockSchema, LocalMoveSchema } from "./tasks";

test("a write can only name a note by its date, never a path", () => {
  const move = { line: 0, raw: "- [ ] x", to: "done" };
  expect(LocalMoveSchema.safeParse({ ...move, date: "2026-09-23" }).success).toBe(true);
  for (const date of ["../../etc/passwd", "2026-09-23/../../x", "2026-09-23.md", ""]) {
    expect(LocalMoveSchema.safeParse({ ...move, date }).success).toBe(false);
    expect(LocalBlockSchema.safeParse({ date, line: 0, block: "", next: "" }).success).toBe(false);
  }
});
