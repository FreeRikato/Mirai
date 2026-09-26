import { z } from "zod";
import { AsrProgressSchema, SegmentSchema, type AsrProgress, type Segment } from "@/shared/later";

export type AsrSink = { progress: (p: AsrProgress) => void; segments: (s: Segment[]) => void };
export type AsrSession = { transcribe: (videoId: string, sink: AsrSink) => Promise<{ model: string }>; close: () => Promise<void> };
export type StartAsr = () => AsrSession;

const EventSchema = z.discriminatedUnion("type", [
  AsrProgressSchema.extend({ type: z.literal("progress"), id: z.string() }),
  z.object({ type: z.literal("segments"), id: z.string(), segments: z.array(SegmentSchema) }),
  z.object({ type: z.literal("done"), id: z.string(), model: z.string() }),
  z.object({ type: z.literal("failed"), id: z.string(), error: z.string() }),
]);

const json = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const lastLine = (text: string) => text.split("\n").filter(l => l.trim() !== "").at(-1);

async function* lines(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffered = "";
  for await (const chunk of stream) {
    buffered += decoder.decode(chunk, { stream: true });
    const parts = buffered.split("\n");
    buffered = parts.pop() ?? "";
    yield* parts;
  }
  if (buffered) yield buffered;
}

type Job = { videoId: string; sink: AsrSink; resolve: (r: { model: string }) => void; reject: (err: Error) => void };

export function createAsr(config: { bin: string; timeoutMs: number }): StartAsr {
  return () => {
    const proc = Bun.spawn([config.bin], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    const stderr = new Response(proc.stderr).text();
    const state: { job: Job | null; broken: Error | null } = { job: null, broken: null };

    const settle = (outcome: { model: string } | Error) => {
      const current = state.job;
      state.job = null;
      if (!current) return;
      if (outcome instanceof Error) current.reject(outcome);
      else current.resolve(outcome);
    };

    const fail = (err: Error) => {
      state.broken ??= err;
      proc.kill("SIGKILL");
      settle(err);
    };

    void (async () => {
      for await (const line of lines(proc.stdout)) {
        const job = state.job;
        if (line.trim() === "" || !job) continue;
        const event = EventSchema.safeParse(json(line));
        if (!event.success || event.data.id !== job.videoId) {
          fail(new Error("transcriber gave unreadable output"));
          continue;
        }
        const e = event.data;
        if (e.type === "progress") job.sink.progress({ stage: e.stage, done: e.done, total: e.total });
        else if (e.type === "segments") job.sink.segments(e.segments);
        else if (e.type === "done") settle({ model: e.model });
        else settle(new Error(e.error));
      }
    })();

    void proc.exited.then(async code => {
      const reason = state.broken ?? new Error(lastLine(await stderr) ?? `transcriber exited with ${code}`);
      state.broken ??= reason;
      settle(reason);
    });

    return {
      transcribe: (videoId, sink) => {
        if (state.broken) return Promise.reject(state.broken);
        if (state.job) return Promise.reject(new Error("transcriber is already busy"));
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => fail(new Error(`transcriber timed out after ${config.timeoutMs}ms`)), config.timeoutMs);
          const done = <T,>(f: (v: T) => void) => (v: T) => {
            clearTimeout(timer);
            f(v);
          };
          state.job = { videoId, sink, resolve: done(resolve), reject: done(reject) };
          proc.stdin.write(`${videoId}\n`);
          proc.stdin.flush();
        });
      },
      close: async () => {
        if (!state.broken) proc.stdin.end();
        await proc.exited;
      },
    };
  };
}
