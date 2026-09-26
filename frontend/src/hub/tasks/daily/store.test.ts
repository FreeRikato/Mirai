import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LocalSnapshot } from "@/shared/tasks";
import { createDailyStore } from "./store";

let dir = "";
afterEach(() => rm(dir, { recursive: true, force: true }));

async function setup(files: Record<string, string>) {
  dir = await mkdtemp(join(tmpdir(), "mirai-daily-"));
  for (const [name, text] of Object.entries(files)) await Bun.write(join(dir, name), text);
  const seen: LocalSnapshot[] = [];
  const store = createDailyStore({ vaultDir: dir, carryDays: 7, settleMs: 10, onChange: s => seen.push(s), today: () => "2026-09-24" });
  await store.start();
  store.stop();
  return { store, seen, read: (name: string) => Bun.file(join(dir, name)).text() };
}

test("only YYYY-MM-DD.md files are notes, newest first", async () => {
  const { store } = await setup({ "2026-09-22.md": "- [ ] a", "2026-09-23.md": "- [x] b", "ideas.md": "- [ ] not a note" });
  const s = store.snapshot();
  expect(s.kind === "ready" && s.notes.map(n => n.date)).toEqual(["2026-09-23", "2026-09-22"]);
  expect(s.kind === "ready" && s.tasks.map(t => t.title)).toEqual(["a", "b"]);
});

test("a move writes the file, publishes a fresh snapshot, and a stale move is refused untouched", async () => {
  const { store, seen, read } = await setup({ "2026-09-23.md": "# day\n- [ ] ship it\n" });
  expect(await store.move({ date: "2026-09-23", line: 1, raw: "- [ ] ship it", to: "doing" })).toEqual({ ok: true });
  expect(await read("2026-09-23.md")).toBe("# day\n- [/] ship it\n");
  const last = seen.at(-1);
  expect(last?.kind === "ready" && last.tasks[0]?.state).toBe("doing");

  expect(await store.move({ date: "2026-09-23", line: 1, raw: "- [ ] ship it", to: "done" })).toMatchObject({ ok: false, status: 409 });
  expect(await read("2026-09-23.md")).toBe("# day\n- [/] ship it\n");
});

test("creating today carries unfinished work once and never overwrites", async () => {
  const { store, read } = await setup({ "2026-09-23.md": "- [ ] left over\n- [x] done" });
  expect(await store.createToday()).toEqual({ ok: true });
  expect(await read("2026-09-24.md")).toBe("- [ ] left over\n");
  expect(await read("2026-09-23.md")).toBe("- [>] left over\n- [x] done");
  expect(await store.createToday()).toMatchObject({ ok: false, status: 409 });
});
