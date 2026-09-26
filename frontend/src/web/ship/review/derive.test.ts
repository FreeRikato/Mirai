import { expect, test } from "bun:test";
import { byFolder, firstToOpen } from "./derive";

const file = (path: string, viewed = false) => ({ path, viewed });

test("files group under their folder, folders and files in path order", () => {
  const groups = byFolder([file("src/workers/sqs/redrive.ts"), file("README.md"), file("src/workers/sqs/consumer.ts"), file("hasura/up.sql")]);
  expect(groups.map(g => [g.folder, g.files.map(f => f.name)])).toEqual([
    ["", ["README.md"]],
    ["hasura", ["up.sql"]],
    ["src/workers/sqs", ["consumer.ts", "redrive.ts"]],
  ]);
});

test("review opens on the first file not yet viewed, in tree order", () => {
  expect(firstToOpen([file("b/x.ts", true), file("a/y.ts"), file("b/z.ts")])).toBe("a/y.ts");
  expect(firstToOpen([file("a.ts", true)])).toBe("a.ts");
  expect(firstToOpen([])).toBeNull();
});
