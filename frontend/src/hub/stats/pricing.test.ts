import { expect, test } from "bun:test";
import { costOf, parseRates, rateFor } from "./pricing";

const table = parseRates({
  "claude-opus-5-5": { input_cost_per_token: 4e-6, output_cost_per_token: 2e-5, cache_read_input_token_cost: 2e-7, cache_creation_input_token_cost: 5e-6 },
  "claude-haiku-4-5": { input_cost_per_token: 1e-6, output_cost_per_token: 5e-6 },
  "openrouter/gpt-6-astra": { input_cost_per_token: 1e-5, output_cost_per_token: 5e-5 },
  "sample_spec": { max_tokens: 1 },
});

test("claude code's [1m] suffix and dated snapshots price at the base model", () => {
  expect(rateFor(table, "claude-opus-5-5[1m]")?.input).toBe(4e-6);
  expect(rateFor(table, "claude-haiku-4-5-20251001")?.output).toBe(5e-6);
});

test("a provider-prefixed entry is reachable by its bare name, and unknown models stay unpriced", () => {
  expect(rateFor(table, "gpt-6-astra")?.input).toBe(1e-5);
  expect(rateFor(table, "glm-5.3-flash")).toBeNull();
  expect(rateFor(table, "sample_spec")).toBeNull();
});

test("cached input is priced at the cache read rate, and falls back to the input rate when a model has none", () => {
  const opus = rateFor(table, "claude-opus-5-5");
  const haiku = rateFor(table, "claude-haiku-4-5");
  const t = { uncached: 1000, cached: 1_000_000, cacheWrite: 1000, output: 1000 };
  expect(opus && costOf(opus, t)).toBeCloseTo(0.004 + 0.2 + 0.005 + 0.02, 10);
  expect(haiku && costOf(haiku, t)).toBeCloseTo(0.001 + 1 + 0.001 + 0.005, 10);
});
