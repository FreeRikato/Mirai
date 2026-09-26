import { expect, test } from "bun:test";
import { HighlightQuerySchema } from "./code";

test("paths that could escape the repository are rejected", () => {
  const base = { repo: "databrainhq/frontend-mono", head: "a".repeat(40), base: "b".repeat(40), side: "new" };
  expect(HighlightQuerySchema.safeParse({ ...base, path: "src/x.ts" }).success).toBe(true);
  for (const path of ["../etc/passwd", "/etc/passwd", "src/../../x", "src//x"]) expect(HighlightQuerySchema.safeParse({ ...base, path }).success).toBe(false);
});
