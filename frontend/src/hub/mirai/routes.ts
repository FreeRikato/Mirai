import { AskSchema, THREAD_ID, ThreadRefSchema, type MiraiEvent, type MiraiStatus } from "@/shared/mirai";
import type { Config } from "../config";
import { readWrite } from "../http";
import { loadEngine } from "./engine";
import { checkCitations, type CitationSources } from "./citations";
import type { MiraiMap } from "./prompt";
import { createThreads, MiraiBusy, MiraiUnknownThread, type Threads } from "./threads";
import { createMiraiTools, type MiraiSources } from "./tools";

const encoder = new TextEncoder();

const HEARTBEAT_MS = 5_000;

export function stream(run: (emit: (e: MiraiEvent) => void) => Promise<void>, heartbeatMs = HEARTBEAT_MS): Response {
  let open = true;
  let beat: ReturnType<typeof setInterval> | undefined;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (text: string) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          open = false;
        }
      };
      beat = setInterval(() => send("\n"), heartbeatMs);
      void run(e => send(`${JSON.stringify(e)}\n`)).finally(() => {
        clearInterval(beat);
        if (!open) return;
        open = false;
        controller.close();
      });
    },
    cancel() {
      open = false;
      clearInterval(beat);
    },
  });
  return new Response(body, { headers: { "content-type": "application/x-ndjson", "cache-control": "no-store" } });
}

export function createMiraiRoutes(mirai: { status: MiraiStatus; threads: Threads | null }) {
  const off = () => Response.json({ error: mirai.status.kind === "off" ? `mirAI is off: ${mirai.status.reason}` : "mirAI is off" }, { status: 503 });
  const idParam = (req: Request) => new URL(req.url).searchParams.get("id") ?? "";

  return {
    "/api/mirai/status": () => Response.json(mirai.status),
    "/api/mirai/threads": async () => Response.json(mirai.threads ? await mirai.threads.list() : []),
    "/api/mirai/thread": (req: Request) => {
      const id = idParam(req);
      if (!THREAD_ID.test(id)) return Response.json({ error: "expected ?id=" }, { status: 400 });
      const thread = mirai.threads?.get(id) ?? null;
      return thread ? Response.json(thread) : Response.json({ error: `no mirAI thread ${id}` }, { status: 404 });
    },
    "/api/mirai/ask": {
      POST: async (req: Request) => {
        const r = await readWrite(req, AskSchema, "{ threadId, question, view }");
        if (!r.ok) return r.res;
        if (!mirai.threads) return off();
        try {
          const { run } = await mirai.threads.begin(r.body);
          return stream(run);
        } catch (err: unknown) {
          if (err instanceof MiraiBusy) return Response.json({ error: err.message }, { status: 409 });
          if (err instanceof MiraiUnknownThread) return Response.json({ error: err.message }, { status: 404 });
          throw err;
        }
      },
    },
    "/api/mirai/stop": {
      POST: async (req: Request) => {
        const r = await readWrite(req, ThreadRefSchema, "{ threadId }");
        if (!r.ok) return r.res;
        const stopped = (await mirai.threads?.stop(r.body.threadId)) ?? false;
        return stopped ? Response.json({ ok: true }) : Response.json({ error: "that thread is not answering" }, { status: 409 });
      },
    },
    "/api/mirai/delete": {
      POST: async (req: Request) => {
        const r = await readWrite(req, ThreadRefSchema, "{ threadId }");
        if (!r.ok) return r.res;
        const gone = (await mirai.threads?.remove(r.body.threadId)) ?? false;
        return gone ? Response.json({ ok: true }) : Response.json({ error: `no mirAI thread ${r.body.threadId}` }, { status: 404 });
      },
    },
  };
}

export async function createMirai(config: Config["mirai"], sources: MiraiSources, map: MiraiMap, cited: CitationSources) {
  const engine = await loadEngine(config, createMiraiTools(sources), map);
  if ("off" in engine) return { routes: createMiraiRoutes({ status: { kind: "off", reason: engine.off }, threads: null }) };
  const threads = createThreads({ engine, dir: config.dir, idleMs: config.idleMs, checkCitations: answer => checkCitations(answer, cited) });
  return { routes: createMiraiRoutes({ status: { kind: "ready", model: engine.label, thinking: config.thinking }, threads }) };
}
