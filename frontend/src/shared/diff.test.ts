import { describe, expect, test } from "bun:test";
import { anchorOf, parsePatch, splitRows, type DiffLine } from "./diff";

const PATCH = ["@@ -41,4 +41,5 @@ export class SqsConsumer {", "   async poll() {", "-    const a = 1;", "-    const b = 2;", "+    const free = 3;", "     return;", "+    // tail", "\\ No newline at end of file"].join("\n");

describe("parsePatch", () => {
  test("numbers old and new lines from the hunk header and skips the no-newline marker", () => {
    const [hunk] = parsePatch(PATCH);
    expect(hunk?.header).toBe("@@ -41,4 +41,5 @@ export class SqsConsumer {");
    expect(hunk?.lines.map(l => [l.kind, l.old, l.new, l.text])).toEqual([
      ["context", 41, 41, "  async poll() {"],
      ["del", 42, null, "    const a = 1;"],
      ["del", 43, null, "    const b = 2;"],
      ["add", null, 42, "    const free = 3;"],
      ["context", 44, 43, "    return;"],
      ["add", null, 44, "    // tail"],
    ]);
  });

  test("splits several hunks and reads headers without a line count", () => {
    const hunks = parsePatch("@@ -1 +1 @@\n-a\n+b\n@@ -10,2 +10,2 @@ fn\n x\n y");
    expect(hunks.map(h => h.lines.map(l => [l.old, l.new]))).toEqual([
      [
        [1, null],
        [null, 1],
      ],
      [
        [10, 10],
        [11, 11],
      ],
    ]);
  });

  test("an empty patch has no hunks", () => {
    expect(parsePatch("")).toEqual([]);
  });
});

describe("splitRows", () => {
  test("pairs a run of deletions with the additions that follow, padding the shorter side", () => {
    const [hunk] = parsePatch(PATCH);
    const rows = hunk ? splitRows(hunk.lines) : [];
    expect(rows.map(r => [r.left?.text ?? null, r.right?.text ?? null])).toEqual([
      ["  async poll() {", "  async poll() {"],
      ["    const a = 1;", "    const free = 3;"],
      ["    const b = 2;", null],
      ["    return;", "    return;"],
      [null, "    // tail"],
    ]);
  });
});

describe("anchorOf", () => {
  test("deleted lines are commented on the old side, everything else on the new side", () => {
    const lines: DiffLine[] = [
      { kind: "del", old: 42, new: null, text: "" },
      { kind: "add", old: null, new: 7, text: "" },
      { kind: "context", old: 44, new: 43, text: "" },
    ];
    expect(lines.map(anchorOf)).toEqual([
      { side: "LEFT", line: 42 },
      { side: "RIGHT", line: 7 },
      { side: "RIGHT", line: 43 },
    ]);
  });
});
