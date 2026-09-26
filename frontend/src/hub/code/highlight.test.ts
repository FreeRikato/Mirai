import { expect, test } from "bun:test";
import { loadConfig } from "../config";
import { createHighlight } from "./highlight";

const { bin } = loadConfig({}).code;

test.skipIf(!(await Bun.file(bin).exists()))("the rust highlighter reads the source from stdin and returns one token list per line", async () => {
  const lines = await createHighlight({ bin, timeoutMs: 5_000 })("a.ts", "const a = 1;\n");
  expect(lines).toEqual([[["const", "#c49bff"], [" a ", "#ffffff"], ["=", "#9a9a9a"], [" ", "#ffffff"], ["1", "#f4b63f"], [";", "#9a9a9a"]], []]);
});
