import { expect, test } from "bun:test";
import { pickLimits } from "./service";

const good = (account: string, checkedAt: number) => ({ ok: true as const, provider: "claude" as const, source: "macato", account, plan: "max 20x", checkedAt, windows: [], resetCredits: null });

test("the freshest reading per account wins, and an account not seen for a day is dropped", () => {
  const out = pickLimits([good("old", 1_000), good("a", 90_000_000)], new Map(), 86_400_000);
  expect(out.filter(l => l.provider === "claude").map(l => (l.ok ? l.account : null))).toEqual(["a"]);
});

test("a provider no machine could read shows the error instead", () => {
  const out = pickLimits([], new Map([["codex", { source: "archikato", error: "api key login has no plan limits" }]]), 86_400_000);
  expect(out.find(l => l.provider === "codex")).toEqual({ ok: false, provider: "codex", source: "archikato", error: "api key login has no plan limits" });
});
