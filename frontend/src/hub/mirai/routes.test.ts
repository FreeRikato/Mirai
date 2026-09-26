import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxProvider, fauxText, type FauxProviderHandle } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { MiraiEventSchema, type MiraiEvent } from "@/shared/mirai";
import { createEngine } from "./engine";
import { createMiraiRoutes, stream } from "./routes";
import { createThreads, type Threads } from "./threads";

let dir: string;
let faux: FauxProviderHandle;
let threads: Threads;

const HUB = "http://hub.test";
const post = (path: string, body: unknown) => new Request(`${HUB}${path}`, { method: "POST", headers: { "content-type": "application/json", origin: HUB }, body: JSON.stringify(body) });

async function events(res: Response): Promise<MiraiEvent[]> {
  const text = await res.text();
  return text
    .split("\n")
    .filter(Boolean)
    .map(line => MiraiEventSchema.parse(JSON.parse(line)));
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "mirai-routes-"));
  faux = fauxProvider();
  const runtime = await ModelRuntime.create({ authPath: join(dir, "auth.json"), modelsPath: join(dir, "models.json") });
  runtime.registerNativeProvider(faux.provider);
  await runtime.setRuntimeApiKey(faux.provider.id, "test");
  threads = createThreads({ engine: createEngine({ runtime, model: faux.getModel(), thinking: "off", tools: [], dir, map: { owner: "the user", machine: "test", home: dir, hubUrl: "http://127.0.0.1:0", dbPath: join(dir, "mirai.db"), wikiDir: dir, vaultDir: undefined, agentPort: 7070, hosts: () => [] } }), dir, idleMs: 60_000 });
});

afterEach(() => {
  threads.close();
  rmSync(dir, { recursive: true, force: true });
});

test("asking streams NDJSON events that end with the saved thread", async () => {
  faux.setResponses([fauxAssistantMessage(fauxText("fine"))]);
  const routes = createMiraiRoutes({ status: { kind: "ready", model: "faux", thinking: "off" }, threads });
  const res = await routes["/api/mirai/ask"].POST(post("/api/mirai/ask", { threadId: null, question: "how is it?", view: "fleet" }));
  expect(res.headers.get("content-type")).toBe("application/x-ndjson");
  const out = await events(res);
  expect(out.map(e => e.type)).toEqual(["thread", "text", "done"]);
  const done = out.at(-1);
  expect(done?.type === "done" && done.thread.turns[0]?.answer).toBe("fine");
});

test("a busy thread answers 409, an unknown one 404, and a hub without a key 503", async () => {
  let release = () => {};
  const gate = new Promise<void>(r => (release = r));
  faux.setResponses([async () => (await gate, fauxAssistantMessage(fauxText("late")))]);
  const routes = createMiraiRoutes({ status: { kind: "ready", model: "faux", thinking: "off" }, threads });
  const first = await routes["/api/mirai/ask"].POST(post("/api/mirai/ask", { threadId: null, question: "slow", view: "fleet" }));
  const reader = first.body?.getReader();
  const head = await reader?.read();
  const opened = MiraiEventSchema.parse(JSON.parse(new TextDecoder().decode(head?.value).split("\n")[0] ?? ""));
  if (opened.type !== "thread") throw new Error(`expected the thread id first, got ${opened.type}`);
  const id = opened.threadId;

  const busy = await routes["/api/mirai/ask"].POST(post("/api/mirai/ask", { threadId: id, question: "again", view: "fleet" }));
  expect(busy.status).toBe(409);
  release();
  await reader?.cancel();

  const unknown = await routes["/api/mirai/ask"].POST(post("/api/mirai/ask", { threadId: "01000000-0000-7000-8000-000000000000", question: "hi", view: "fleet" }));
  expect(unknown.status).toBe(404);

  const off = createMiraiRoutes({ status: { kind: "off", reason: "OPENAI_API_KEY is not set" }, threads: null });
  const refused = await off["/api/mirai/ask"].POST(post("/api/mirai/ask", { threadId: null, question: "hi", view: "fleet" }));
  expect(refused.status).toBe(503);
  expect(await refused.json()).toEqual({ error: "mirAI is off: OPENAI_API_KEY is not set" });
});

test("stop on an idle thread, a bad or unknown thread id, and deleting a missing thread all say why", async () => {
  faux.setResponses([fauxAssistantMessage(fauxText("fine"))]);
  const routes = createMiraiRoutes({ status: { kind: "ready", model: "faux", thinking: "off" }, threads });
  const out = await events(await routes["/api/mirai/ask"].POST(post("/api/mirai/ask", { threadId: null, question: "hi", view: "fleet" })));
  const opened = out[0];
  if (opened?.type !== "thread") throw new Error("expected the thread id first");

  const idle = await routes["/api/mirai/stop"].POST(post("/api/mirai/stop", { threadId: opened.threadId }));
  expect(idle.status).toBe(409);
  expect((await routes["/api/mirai/thread"](new Request(`${HUB}/api/mirai/thread?id=../../etc`))).status).toBe(400);
  expect((await routes["/api/mirai/thread"](new Request(`${HUB}/api/mirai/thread?id=01000000-0000-7000-8000-000000000000`))).status).toBe(404);
  expect((await routes["/api/mirai/delete"].POST(post("/api/mirai/delete", { threadId: "01000000-0000-7000-8000-000000000000" }))).status).toBe(404);
  expect((await routes["/api/mirai/delete"].POST(post("/api/mirai/delete", { threadId: opened.threadId }))).status).toBe(200);

  const off = createMiraiRoutes({ status: { kind: "off", reason: "no key" }, threads: null });
  expect(await (await off["/api/mirai/threads"]()).json()).toEqual([]);
});

test("a silent run keeps its stream alive with blank lines the browser skips", async () => {
  const res = stream(async emit => {
    await Bun.sleep(60);
    emit({ type: "text", delta: "done" });
  }, 10);
  const text = await res.text();
  expect(text.startsWith("\n\n")).toBe(true);
  expect(text.trim()).toBe(JSON.stringify({ type: "text", delta: "done" }));
});
