import { expect, test } from "bun:test";
import type { Embed } from "@/shared/later";
import { openDb } from "../db";
import type { AsrSink, StartAsr } from "./asr";
import type { Ingested } from "./ingest";
import { createLaterStore, laterItem } from "./store";
import { createTranscripts, readySegments } from "./transcripts";

const video = (url: string, embed: Embed): Ingested => ({ url, kind: "watch", embed, title: url, site: "youtube.com", author: null, image: null, lengthSec: 600, worth: "unscored", tldr: [], chapters: [], content: null });

type Transcribe = (videoId: string, sink: AsrSink) => Promise<{ model: string }>;

const heard: Transcribe = async (videoId, sink) => {
  sink.segments([{ start: 0.84, end: 4.24, text: `hello from ${videoId}` }]);
  return { model: "parakeet cuda" };
};

function setup(transcribe: Transcribe = heard) {
  let clock = 1_000;
  const db = openDb(":memory:");
  const now = () => clock;
  const later = createLaterStore({
    db,
    now,
    ingest: async url => {
      const id = new URL(url).searchParams.get("v");
      return video(url, id ? { type: "youtube", videoId: id } : { type: "article" });
    },
  });
  const calls: string[] = [];
  const sessions = { started: 0, closed: 0 };
  const start: StartAsr = () => {
    sessions.started++;
    return {
      transcribe: (id, sink) => {
        calls.push(id);
        return transcribe(id, sink);
      },
      close: async () => {
        sessions.closed++;
      },
    };
  };
  const transcripts = createTranscripts({ db, now, maxAttempts: 3, retryMs: 300_000, start });
  return { db, later, transcripts, calls, sessions, tick: (ms: number) => (clock += ms) };
}

test("a saved YouTube video is transcribed on the next tick", async () => {
  const { later, transcripts, calls } = setup();
  await later.save("https://www.youtube.com/watch?v=EWSUvEyFwjc");
  expect(transcripts.get("EWSUvEyFwjc")).toEqual({ status: "queued" });
  await transcripts.tick();
  expect(calls).toEqual(["EWSUvEyFwjc"]);
  expect(transcripts.get("EWSUvEyFwjc")).toEqual({ status: "ready", model: "parakeet cuda", segments: [{ start: 0.84, end: 4.24, text: "hello from EWSUvEyFwjc" }] });
});

test("every saved video is transcribed once, oldest save first, and articles never are", async () => {
  const { later, transcripts, calls, tick } = setup();
  await later.save("https://www.youtube.com/watch?v=2qNX30hTyDg");
  tick(10);
  await later.save("https://pganalyze.com/blog/rls");
  tick(10);
  await later.save("https://www.youtube.com/watch?v=EWSUvEyFwjc");
  for (let i = 0; i < 4; i++) await transcripts.tick();
  expect(calls).toEqual(["2qNX30hTyDg", "EWSUvEyFwjc"]);
});

test("a tick while a transcription is running does not start a second one", async () => {
  let finish: () => void = () => {};
  const gate = new Promise<void>(resolve => (finish = resolve));
  const { later, transcripts, calls, sessions } = setup(async (id, sink) => {
    await gate;
    return heard(id, sink);
  });
  await later.save("https://www.youtube.com/watch?v=2qNX30hTyDg");
  await later.save("https://www.youtube.com/watch?v=EWSUvEyFwjc");
  const first = transcripts.tick();
  await transcripts.tick();
  expect(calls).toEqual(["2qNX30hTyDg"]);
  expect(transcripts.get("2qNX30hTyDg")).toMatchObject({ status: "running" });
  finish();
  await first;
  expect(transcripts.get("2qNX30hTyDg").status).toBe("ready");
  expect(sessions.started).toBe(1);
});

test("a failed transcription retries after 5 min, then 30 min, then waits for a manual retry", async () => {
  let broken = true;
  const { later, transcripts, calls, tick } = setup(async (id, sink) => {
    if (broken) throw new Error("ERROR: [youtube] Sign in to confirm you're not a bot");
    return heard(id, sink);
  });
  await later.save("https://www.youtube.com/watch?v=EWSUvEyFwjc");
  await transcripts.tick();
  expect(transcripts.get("EWSUvEyFwjc")).toEqual({ status: "failed", error: "ERROR: [youtube] Sign in to confirm you're not a bot", retryAt: 1_000 + 300_000 });
  tick(299_999);
  await transcripts.tick();
  expect(calls).toHaveLength(1);
  tick(1);
  await transcripts.tick();
  expect(transcripts.get("EWSUvEyFwjc")).toMatchObject({ status: "failed", retryAt: 301_000 + 1_800_000 });
  tick(1_800_000);
  await transcripts.tick();
  expect(transcripts.get("EWSUvEyFwjc")).toMatchObject({ status: "failed", retryAt: null });
  tick(86_400_000);
  await transcripts.tick();
  expect(calls).toHaveLength(3);
  broken = false;
  transcripts.retry("EWSUvEyFwjc");
  expect(transcripts.get("EWSUvEyFwjc")).toEqual({ status: "queued" });
  await transcripts.tick();
  expect(transcripts.get("EWSUvEyFwjc").status).toBe("ready");
});

test("a transcription cut off by a hub restart runs again after the restart", async () => {
  const { db, later, transcripts } = setup(() => new Promise(() => {}));
  await later.save("https://www.youtube.com/watch?v=EWSUvEyFwjc");
  void transcripts.tick();
  expect(transcripts.get("EWSUvEyFwjc")).toMatchObject({ status: "running" });
  const restarted = createTranscripts({ db, maxAttempts: 3, retryMs: 300_000, start: () => ({ transcribe: heard, close: async () => {} }) });
  expect(restarted.get("EWSUvEyFwjc")).toEqual({ status: "queued" });
  await restarted.tick();
  expect(restarted.get("EWSUvEyFwjc").status).toBe("ready");
});

test("while a video is being transcribed, its latest progress and the lines so far can be read", async () => {
  let finish: () => void = () => {};
  const { later, transcripts } = setup(
    (_id, sink) =>
      new Promise(resolve => {
        sink.progress({ stage: "downloading", done: 44_719_800, total: 44_719_800 });
        sink.progress({ stage: "transcribing", done: 10.38, total: 3303.86 });
        sink.segments([{ start: 0.84, end: 4.24, text: "Um personally I think that uh" }]);
        sink.segments([{ start: 5.19, end: 10.38, text: "The best use of AI is pair programming." }]);
        finish = () => resolve({ model: "parakeet cuda" });
      }),
  );
  await later.save("https://www.youtube.com/watch?v=EWSUvEyFwjc");
  const run = transcripts.tick();
  expect(transcripts.get("EWSUvEyFwjc")).toEqual({
    status: "running",
    progress: { stage: "transcribing", done: 10.38, total: 3303.86 },
    segments: [
      { start: 0.84, end: 4.24, text: "Um personally I think that uh" },
      { start: 5.19, end: 10.38, text: "The best use of AI is pair programming." },
    ],
  });
  finish();
  await run;
  expect(transcripts.get("EWSUvEyFwjc")).toEqual({
    status: "ready",
    model: "parakeet cuda",
    segments: [
      { start: 0.84, end: 4.24, text: "Um personally I think that uh" },
      { start: 5.19, end: 10.38, text: "The best use of AI is pair programming." },
    ],
  });
});

test("a video that has not started yet reports no progress and no lines", async () => {
  let finish: () => void = () => {};
  const { later, transcripts } = setup((id, sink) => new Promise(resolve => (finish = () => resolve(heard(id, sink)))));
  await later.save("https://www.youtube.com/watch?v=EWSUvEyFwjc");
  const run = transcripts.tick();
  expect(transcripts.get("EWSUvEyFwjc")).toEqual({ status: "running", progress: null, segments: [] });
  finish();
  await run;
});

test("a backlog is drained by one transcriber session, so the model loads once", async () => {
  const { later, transcripts, calls, sessions } = setup();
  await later.save("https://www.youtube.com/watch?v=2qNX30hTyDg");
  await later.save("https://www.youtube.com/watch?v=EWSUvEyFwjc");
  await later.save("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  await transcripts.tick();
  expect(calls).toEqual(["2qNX30hTyDg", "EWSUvEyFwjc", "dQw4w9WgXcQ"]);
  expect(sessions).toEqual({ started: 1, closed: 1 });
});

test("a failure closes the session, and the rest of the backlog waits for a fresh one on the next tick", async () => {
  const { later, transcripts, calls, sessions } = setup(async (id, sink) => {
    if (id === "2qNX30hTyDg") throw new Error("transcriber exited with 1");
    return heard(id, sink);
  });
  await later.save("https://www.youtube.com/watch?v=2qNX30hTyDg");
  await later.save("https://www.youtube.com/watch?v=EWSUvEyFwjc");
  await transcripts.tick();
  expect(calls).toEqual(["2qNX30hTyDg"]);
  expect(sessions).toEqual({ started: 1, closed: 1 });
  await transcripts.tick();
  expect(transcripts.get("EWSUvEyFwjc").status).toBe("ready");
  expect(sessions).toEqual({ started: 2, closed: 2 });
});

test("mirAI's citation checks read a saved item with its text and only a finished transcript", async () => {
  const { db, later, transcripts } = setup();
  const saved = await later.save("https://www.youtube.com/watch?v=EWSUvEyFwjc");
  expect(laterItem(db, saved.id)).toEqual({ item: expect.objectContaining({ id: saved.id, embed: { type: "youtube", videoId: "EWSUvEyFwjc" } }), content: null });
  expect(laterItem(db, "gone")).toBeNull();
  expect(readySegments(db, "EWSUvEyFwjc")).toBeNull();
  await transcripts.tick();
  expect(readySegments(db, "EWSUvEyFwjc")).toEqual([{ start: 0.84, end: 4.24, text: "hello from EWSUvEyFwjc" }]);
});
