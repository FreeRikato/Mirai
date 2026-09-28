import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const SOURCE = readFileSync(new URL("./checks.ts", import.meta.url), "utf8");

test("doctor validates shell configuration and fleet responses before using them", () => {
  expect(SOURCE).toContain("ShellConfigSchema");
  expect(SOURCE).toContain("PluginManifestSchema");
  expect(SOURCE).toContain("FleetSchema.parse(await response.json())");
  expect(SOURCE).toContain("safeParse");
  expect(SOURCE).not.toContain("JSON.parse(readFileSync(shell, \"utf8\")) as");
  expect(SOURCE).not.toContain("(await response.json()) as");
});
