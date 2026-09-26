import { expect, test } from "bun:test";
import { EnvSchema, loadConfig } from "./config";

const EXAMPLE = `${import.meta.dir}/../../.env.example`;

test(".env.example lists exactly the variables the hub reads, with the real defaults", async () => {
  const lines = (await Bun.file(EXAMPLE).text()).split("\n").filter(l => /^[A-Z0-9_]+=/.test(l));
  const example = Object.fromEntries(lines.map(l => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
  expect(Object.keys(example).toSorted()).toEqual(Object.keys(EnvSchema.shape).toSorted());
  const defaults = new Map<string, unknown>(Object.entries(EnvSchema.parse({})));
  for (const [key, value] of Object.entries(example)) {
    const applied = defaults.get(key);
    expect({ key, value: value === "" ? undefined : value }).toEqual({ key, value: applied === undefined ? undefined : String(applied) });
  }
});

test("a blank value means the default, and nothing personal has a default", () => {
  const c = loadConfig({ MIRAI_TEMP_HOT_C: " ", LINEAR_API_KEY: "" });
  expect(c.settings.fleet.tempHotC).toBe(80);
  expect(c.tasks.vaultDir).toBeUndefined();
  expect(c.tasks.linear.apiKey).toBeUndefined();
});

test("a malformed value stops the hub instead of being guessed", () => {
  expect(() => loadConfig({ PORT: "eighty" })).toThrow();
  expect(() => loadConfig({ MIRAI_TASKS_POLL_MS: "0" })).toThrow();
});
