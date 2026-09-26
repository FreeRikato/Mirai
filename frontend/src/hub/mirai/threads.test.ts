import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxThinking, fauxToolCall, type FauxProviderHandle } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { CitationCheck, MiraiEvent } from "@/shared/mirai";
import { createEngine } from "./engine";
import type { MiraiMap } from "./prompt";
import { createMiraiTools, type MiraiSources } from "./tools";
import { createThreads, MiraiBusy } from "./threads";

let dir: string;
let home: string;
let faux: FauxProviderHandle;
let opens = 0;

const unavailable = { kind: "unavailable", reason: "not in this test" } as const;

const sources: MiraiSources = {
  fleet: () => null,
  events: () => [],
  host: () => null,
  tasks: { local: () => unavailable, linear: async () => unavailable, github: async () => unavailable, priority: async () => unavailable },
  ship: async () => unavailable,
  stats: async () => Promise.reject(new Error("no stats in this test")),
  now: () => Date.parse("2026-09-26T10:00:00Z"),
};

const mapFor = (home: string): MiraiMap => ({ owner: "the user", machine: "test", home, hubUrl: "http://127.0.0.1:0", dbPath: join(home, "mirai.db"), wikiDir: join(home, "llm-wiki"), vaultDir: undefined, agentPort: 7070, hosts: () => [] });

async function setup(idleMs = 60_000, now: () => number = Date.now, checkCitations?: (answer: string) => CitationCheck[]) {
  const runtime = await ModelRuntime.create({ authPath: join(dir, "auth.json"), modelsPath: join(dir, "models.json") });
  runtime.registerNativeProvider(faux.provider);
  await runtime.setRuntimeApiKey(faux.provider.id, "test");
  const base = createEngine({ runtime, model: faux.getModel(), thinking: "off", tools: createMiraiTools(sources), dir, map: mapFor(home) });
  const engine = {
    ...base,
    open: (manager: Parameters<typeof base.open>[0]) => {
      opens += 1;
      return base.open(manager);
    },
  };
  return createThreads({ engine, dir, idleMs, now, checkCitations });
}

async function ask(threads: Awaited<ReturnType<typeof setup>>, threadId: string | null, question: string, view = "tasks / linear") {
  const events: MiraiEvent[] = [];
  const { run } = await threads.begin({ threadId, question, view });
  await run(e => events.push(e));
  return events;
}

beforeEach(() => {
  opens = 0;
  dir = mkdtempSync(join(tmpdir(), "mirai-threads-"));
  home = mkdtempSync(join(tmpdir(), "mirai-home-"));
  faux = fauxProvider();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

test("a question streams thinking, a read and the answer, then settles into a saved thread", async () => {
  faux.setResponses([
    fauxAssistantMessage([fauxThinking("check linear"), fauxToolCall("tasks", { source: "linear" })], { stopReason: "toolUse" }),
    fauxAssistantMessage(fauxText("Pick DB-412.")),
  ]);
  const threads = await setup();
  const events = await ask(threads, null, "what should I pick up next?");

  const types = events.map(e => e.type);
  expect(types[0]).toBe("thread");
  expect(types).toContain("thinking");
  expect(events).toContainEqual({ type: "call", id: expect.any(String), label: "read tasks · linear", change: false });
  expect(events.filter(e => e.type === "text").map(e => (e.type === "text" ? e.delta : "")).join("")).toBe("Pick DB-412.");
  const done = events.at(-1);
  if (done?.type !== "done") throw new Error(`expected done, got ${done?.type}`);
  expect(done.thread.turns).toEqual([
    expect.objectContaining({ question: "what should I pick up next?", view: "tasks / linear", thinking: "check linear", answer: "Pick DB-412.", status: "done", calls: [expect.objectContaining({ label: "read tasks · linear", change: false, ok: true })] }),
  ]);

  const [summary] = await threads.list();
  expect(summary).toEqual(expect.objectContaining({ id: done.thread.id, title: "what should I pick up next?", view: "tasks / linear", questions: 1 }));
  threads.close();
});

test("mirAI runs pi's own shell and file tools from home, without the hub's secrets, and marks what changed the disk", async () => {
  mkdirSync(join(home, "llm-wiki"));
  process.env.MIRAI_FAKE_API_KEY = "sk-planted";
  process.env.MIRAI_FAKE_PLAIN = "kept";
  let shellOutput = "";
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall("bash", { command: "pwd; echo key=$MIRAI_FAKE_API_KEY plain=$MIRAI_FAKE_PLAIN" }), fauxToolCall("write", { path: "llm-wiki/CI Stalls.md", content: "# CI Stalls\n\nomarikato ran out of memory\n" })], { stopReason: "toolUse" }),
    context => {
      shellOutput = context.messages.flatMap(m => (m.role === "toolResult" && m.toolName === "bash" ? m.content.flatMap(c => (c.type === "text" ? [c.text] : [])) : [])).join("");
      return fauxAssistantMessage(fauxText("Wrote CI Stalls."));
    },
  ]);
  const threads = await setup();
  const events = await ask(threads, null, "write up the omarikato stall");
  delete process.env.MIRAI_FAKE_API_KEY;
  delete process.env.MIRAI_FAKE_PLAIN;

  expect(shellOutput).toContain(home);
  expect(shellOutput).toContain("key= plain=kept");
  expect(readFileSync(join(home, "llm-wiki", "CI Stalls.md"), "utf8")).toBe("# CI Stalls\n\nomarikato ran out of memory\n");
  expect(events.flatMap(e => (e.type === "call" ? [e.change] : []))).toEqual([false, true]);
  const done = events.at(-1);
  if (done?.type !== "done") throw new Error(`expected done, got ${done?.type}`);
  expect(done.thread.turns[0]?.calls.map(({ label, change, ok }) => ({ label, change, ok }))).toEqual([
    { label: "$ pwd; echo key=$MIRAI_FAKE_API_KEY plain=$MIRAI_FAKE_PLAIN", change: false, ok: true },
    { label: "wrote llm-wiki/CI Stalls.md +3", change: true, ok: true },
  ]);
  threads.close();
});

test("a settled answer's citations are checked once and stay attached to that turn after a reload", async () => {
  faux.setResponses([fauxAssistantMessage(fauxText("Clocks matter [▶ 27:51](/content/item/v?t=1671), not [▶ 63:02](/content/item/v?t=3782)."))]);
  const checks: CitationCheck[] = [
    { key: "v\nmoment\n1671", status: "ok", reason: null },
    { key: "v\nmoment\n3782", status: "failed", reason: "not in transcript" },
  ];
  const seen: string[] = [];
  const threads = await setup(60_000, Date.now, answer => {
    seen.push(answer);
    return checks;
  });
  const events = await ask(threads, null, "why do clocks matter?", "content / watch · v · CockroachDB");
  const threadId = events[0]?.type === "thread" ? events[0].threadId : "";
  threads.close();

  expect(seen).toEqual(["Clocks matter [▶ 27:51](/content/item/v?t=1671), not [▶ 63:02](/content/item/v?t=3782)."]);
  const reopened = await setup();
  expect(reopened.get(threadId)?.turns[0]?.citations).toEqual(checks);
  reopened.close();
});

test("a checker that throws still settles the answer, just without citation checks", async () => {
  faux.setResponses([fauxAssistantMessage(fauxText("See [▶ 1:00](/content/item/v?t=60)."))]);
  const threads = await setup(60_000, Date.now, () => {
    throw new RangeError("bad entity");
  });
  const done = (await ask(threads, null, "what happens at one minute?")).at(-1);
  if (done?.type !== "done") throw new Error(`expected done, got ${done?.type}`);
  expect(done.thread.turns[0]?.citations).toEqual([]);
  threads.close();
});

test("an old thread resumes with its earlier turns after the hub forgets it", async () => {
  let resent: string[] = [];
  faux.setResponses([
    fauxAssistantMessage(fauxText("DB-412.")),
    context => {
      resent = context.messages.flatMap(m => (m.role !== "user" ? [] : typeof m.content === "string" ? [m.content] : m.content.flatMap(c => (c.type === "text" ? [c.text] : []))));
      return fauxAssistantMessage(fauxText("Still DB-412."));
    },
  ]);
  const first = await setup();
  const events = await ask(first, null, "what next?");
  const threadId = events[0]?.type === "thread" ? events[0].threadId : "";
  first.close();

  const second = await setup();
  await ask(second, threadId, "and now?", "ship");
  const thread = second.get(threadId);
  expect(thread?.turns.map(t => [t.question, t.view, t.answer])).toEqual([
    ["what next?", "tasks / linear", "DB-412."],
    ["and now?", "ship", "Still DB-412."],
  ]);
  expect(resent).toEqual(["[view: tasks / linear]\nwhat next?", "[view: ship]\nand now?"]);
  second.close();
});

test("a second question on a thread that is still answering is refused", async () => {
  let release = () => {};
  const gate = new Promise<void>(r => (release = r));
  faux.setResponses([async () => (await gate, fauxAssistantMessage(fauxText("done")))]);
  const threads = await setup();
  const { threadId, run } = await threads.begin({ threadId: null, question: "slow one", view: "fleet" });
  const running = run(() => {});
  await expect(threads.begin({ threadId, question: "again", view: "fleet" })).rejects.toBeInstanceOf(MiraiBusy);
  expect(threads.get(threadId)?.busy).toBe(true);
  release();
  await running;
  expect(threads.get(threadId)?.busy).toBe(false);
  threads.close();
});

test("deleting a thread removes it from history", async () => {
  faux.setResponses([fauxAssistantMessage(fauxText("ok"))]);
  const threads = await setup();
  const events = await ask(threads, null, "hi");
  const threadId = events[0]?.type === "thread" ? events[0].threadId : "";
  expect(await threads.remove(threadId)).toBe(true);
  expect(await threads.list()).toEqual([]);
  expect(threads.get(threadId)).toBeNull();
  threads.close();
});

test("stopping a running answer saves the turn as stopped with what it had so far", async () => {
  let release = () => {};
  const gate = new Promise<void>(r => (release = r));
  faux.setResponses([
    async (_context, options) => {
      options?.signal?.addEventListener("abort", () => release());
      await gate;
      return fauxAssistantMessage([], { stopReason: "aborted" });
    },
  ]);
  const threads = await setup();
  const { threadId, run } = await threads.begin({ threadId: null, question: "long one", view: "fleet" });
  const running = run(() => {});
  await Bun.sleep(20);
  expect(await threads.stop(threadId)).toBe(true);
  await running;
  expect(threads.get(threadId)?.turns.map(t => t.status)).toEqual(["stopped"]);
  expect(await threads.stop(threadId)).toBe(false);
  threads.close();
});

test("a thread idle past the limit is unloaded and resumes from its file on the next question", async () => {
  faux.setResponses([fauxAssistantMessage(fauxText("one")), fauxAssistantMessage(fauxText("two"))]);
  let clock = 1_000_000;
  const threads = await setup(60_000, () => clock);
  const events = await ask(threads, null, "first");
  const threadId = events[0]?.type === "thread" ? events[0].threadId : "";
  clock += 30_000;
  await ask(threads, threadId, "second");
  expect(opens).toBe(1);
  clock += 120_000;
  faux.appendResponses([fauxAssistantMessage(fauxText("three"))]);
  await ask(threads, threadId, "third");
  expect(opens).toBe(2);
  expect(threads.get(threadId)?.turns.map(t => t.answer)).toEqual(["one", "two", "three"]);
  threads.close();
});
