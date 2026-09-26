import { expect, test } from "bun:test";
import { fauxAssistantMessage, fauxText, fauxThinking, fauxToolCall } from "@earendil-works/pi-ai";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import type { CitationCheck } from "@/shared/mirai";
import { CITE_MARK, STOP_MARK, summaryOf, turnsOf } from "./transcript";

const at = (s: number) => new Date(Date.parse("2026-09-26T10:00:00Z") + s * 1000).toISOString();
let n = 0;
const entry = (s: number, message: Extract<SessionEntry, { type: "message" }>["message"]): SessionEntry => ({ type: "message", id: `e${++n}`, parentId: null, timestamp: at(s), message });
const user = (s: number, text: string) => entry(s, { role: "user", content: [{ type: "text", text }], timestamp: Date.parse(at(s)) });

test("a turn gathers thinking, calls, answer and cost across the assistant steps, timed to the last one", () => {
  const call = fauxToolCall("machines", { host: "omarikato" }, { id: "c1" });
  const turns = turnsOf([
    user(0, "[view: omarikato / host]\nwhy is it slow?"),
    entry(2, fauxAssistantMessage([fauxThinking("check memory"), call], { stopReason: "toolUse" })),
    entry(3, { role: "toolResult", toolCallId: "c1", toolName: "machines", content: [{ type: "text", text: "{}" }], isError: false, timestamp: Date.parse(at(3)) }),
    entry(7, fauxAssistantMessage(fauxText("Chromium lanes."))),
  ]);
  expect(turns).toEqual([
    expect.objectContaining({ question: "why is it slow?", view: "omarikato / host", thinking: "check memory", calls: [{ id: "c1", label: "read machines · omarikato", change: false, ok: true }], answer: "Chromium lanes.", status: "done", error: null, tookMs: 7000 }),
  ]);
  expect(summaryOf("t1", turns, 0)).toEqual(expect.objectContaining({ title: "why is it slow?", view: "omarikato / host", questions: 1, spend: [{ at: Date.parse(at(0)), costUsd: 0 }] }));
});

test("a stop marked by the hub calls as stopped, a provider error keeps its message, and a turn with no final answer calls as cut off", () => {
  const turns = turnsOf([
    user(0, "[view: fleet]\nplan my week"),
    entry(4, fauxAssistantMessage([], { stopReason: "error", errorMessage: "The operation was aborted." })),
    { type: "custom", customType: STOP_MARK, id: "s1", parentId: null, timestamp: at(4) },
    user(10, "[view: fleet]\nagain"),
    entry(11, fauxAssistantMessage([], { stopReason: "error", errorMessage: "socket connection aborted by peer" })),
    user(20, "[view: fleet]\nand now"),
    entry(21, fauxAssistantMessage([fauxToolCall("machines", {}, { id: "c9" })], { stopReason: "toolUse" })),
  ]);
  expect(turns.map(t => [t.status, t.error])).toEqual([
    ["stopped", null],
    ["error", "socket connection aborted by peer"],
    ["error", "the answer was cut off before it finished"],
  ]);
});

test("a failed attempt that pi retried leaves no partial text, but its cost and compaction cost still count", () => {
  const costing = <M extends { usage: { cost: { total: number } } }>(m: M, total: number): M => ({ ...m, usage: { ...m.usage, cost: { ...m.usage.cost, total } } });
  const failed = costing(fauxAssistantMessage(fauxText("half an ans"), { stopReason: "error", errorMessage: "529 overloaded" }), 0.01);
  const good = costing(fauxAssistantMessage(fauxText("Full answer.")), 0.02);
  const [turn] = turnsOf([
    user(0, "[view: fleet]\nq"),
    entry(1, failed),
    entry(3, good),
    { type: "compaction", id: "c1", parentId: null, timestamp: at(4), summary: "s", firstKeptEntryId: "e1", tokensBefore: 1, usage: { ...good.usage, cost: { ...good.usage.cost, total: 0.005 } } },
  ]);
  expect(turn?.answer).toBe("Full answer.");
  expect(turn?.status).toBe("done");
  expect(turn?.costUsd).toBeCloseTo(0.035);
});

test("saved citation checks attach to their turn, and corrupt ones read as none", () => {
  const good: CitationCheck = { key: "v\nmoment\n60", status: "ok", reason: null };
  const turns = turnsOf([
    user(0, "[view: fleet]\nfirst"),
    entry(1, fauxAssistantMessage(fauxText("[▶ 1:00](/content/item/v?t=60)"))),
    { type: "custom", customType: CITE_MARK, data: [good], id: "c1", parentId: null, timestamp: at(2) },
    user(3, "[view: fleet]\nsecond"),
    entry(4, fauxAssistantMessage(fauxText("again"))),
    { type: "custom", customType: CITE_MARK, data: [{ href: "old shape", ok: true }], id: "c2", parentId: null, timestamp: at(5) },
  ]);
  expect(turns.map(t => t.citations)).toEqual([[good], []]);
});
