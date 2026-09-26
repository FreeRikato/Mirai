import { afterAll, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AsrProgress, Segment } from "@/shared/later";
import { createAsr } from "./asr";

const dir = mkdtempSync(join(tmpdir(), "mirai-asr-test-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function fakeBin(name: string, perVideo: string): string {
  const path = join(dir, name);
  writeFileSync(path, `#!/usr/bin/env bash\necho started >> "${join(dir, `${name}.starts`)}"\necho "loading model" >&2\nwhile read -r id; do\n${perVideo}\ndone\n`);
  chmodSync(path, 0o755);
  return path;
}

const starts = (name: string) => readFileSync(join(dir, `${name}.starts`), "utf8").trim().split("\n").length;

function recorder() {
  const seen: ({ progress: AsrProgress } | { segments: Segment[] })[] = [];
  return { seen, sink: { progress: (progress: AsrProgress) => seen.push({ progress }), segments: (segments: Segment[]) => seen.push({ segments }) } };
}

test("one transcriber process handles several videos in turn, reporting progress and lines as it prints them", async () => {
  const bin = fakeBin(
    "ok",
    [
      `echo "{\\"type\\":\\"progress\\",\\"id\\":\\"$id\\",\\"stage\\":\\"downloading\\",\\"done\\":1024,\\"total\\":44719800}"`,
      `echo "{\\"type\\":\\"segments\\",\\"id\\":\\"$id\\",\\"segments\\":[{\\"start\\":0.84,\\"end\\":4.24,\\"text\\":\\"$id says hi\\"}]}"`,
      `sleep 0.1`,
      `echo "{\\"type\\":\\"progress\\",\\"id\\":\\"$id\\",\\"stage\\":\\"transcribing\\",\\"done\\":4.24,\\"total\\":3303.86}"`,
      `echo "{\\"type\\":\\"done\\",\\"id\\":\\"$id\\",\\"model\\":\\"parakeet cuda\\"}"`,
    ].join("\n"),
  );
  const session = createAsr({ bin, timeoutMs: 5_000 })();
  const first = recorder();
  expect(await session.transcribe("EWSUvEyFwjc", first.sink)).toEqual({ model: "parakeet cuda" });
  expect(first.seen).toEqual([
    { progress: { stage: "downloading", done: 1024, total: 44719800 } },
    { segments: [{ start: 0.84, end: 4.24, text: "EWSUvEyFwjc says hi" }] },
    { progress: { stage: "transcribing", done: 4.24, total: 3303.86 } },
  ]);
  const second = recorder();
  expect(await session.transcribe("2qNX30hTyDg", second.sink)).toEqual({ model: "parakeet cuda" });
  expect(second.seen).toContainEqual({ segments: [{ start: 0.84, end: 4.24, text: "2qNX30hTyDg says hi" }] });
  await session.close();
  expect(starts("ok")).toBe(1);
});

test("a video the transcriber reports as failed rejects with its error, and the next video still runs", async () => {
  const bin = fakeBin(
    "one-bad",
    `if [ "$id" = aaaaaaaaaaa ]; then echo "{\\"type\\":\\"failed\\",\\"id\\":\\"$id\\",\\"error\\":\\"ERROR: [youtube] $id: This video is unavailable\\"}"; else echo "{\\"type\\":\\"done\\",\\"id\\":\\"$id\\",\\"model\\":\\"parakeet cuda\\"}"; fi`,
  );
  const session = createAsr({ bin, timeoutMs: 5_000 })();
  await expect(session.transcribe("aaaaaaaaaaa", recorder().sink)).rejects.toThrow("ERROR: [youtube] aaaaaaaaaaa: This video is unavailable");
  expect(await session.transcribe("EWSUvEyFwjc", recorder().sink)).toEqual({ model: "parakeet cuda" });
  await session.close();
});

test("a transcriber that crashes rejects with the last line it wrote to stderr, and the session stays broken", async () => {
  const bin = fakeBin("crash", `echo "CUDA out of memory" >&2; exit 1`);
  const session = createAsr({ bin, timeoutMs: 5_000 })();
  await expect(session.transcribe("EWSUvEyFwjc", recorder().sink)).rejects.toThrow("CUDA out of memory");
  await expect(session.transcribe("2qNX30hTyDg", recorder().sink)).rejects.toThrow("CUDA out of memory");
  await session.close();
});

test("output that is not a transcript event for the current video is rejected instead of stored", async () => {
  const cases = [
    { name: "wrong-shape", line: `echo "{\\"type\\":\\"segments\\",\\"id\\":\\"$id\\",\\"segments\\":\\"nope\\"}"` },
    { name: "not-json", line: `echo "loaded model"` },
    { name: "other-video", line: `echo '{"type":"done","id":"zzzzzzzzzzz","model":"parakeet cuda"}'` },
  ];
  for (const bad of cases) {
    const session = createAsr({ bin: fakeBin(bad.name, `${bad.line}; sleep 30`), timeoutMs: 5_000 })();
    await expect(session.transcribe("EWSUvEyFwjc", recorder().sink)).rejects.toThrow("unreadable output");
    await session.close();
  }
});

test("a transcriber that hangs is killed after the timeout", async () => {
  const session = createAsr({ bin: fakeBin("hang", "sleep 30"), timeoutMs: 200 })();
  const started = Date.now();
  await expect(session.transcribe("EWSUvEyFwjc", recorder().sink)).rejects.toThrow("timed out after 200ms");
  await session.close();
  expect(Date.now() - started).toBeLessThan(5_000);
});
