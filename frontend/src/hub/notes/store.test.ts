import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NotesSnapshot } from "@/shared/notes";
import { createNotesStore } from "./store";

let dir = "";
afterEach(() => rm(dir, { recursive: true, force: true }));

async function setup(files: Record<string, string>) {
  dir = await mkdtemp(join(tmpdir(), "mirai-notes-"));
  for (const [name, text] of Object.entries(files)) await Bun.write(join(dir, name), text);
  const seen: NotesSnapshot[] = [];
  const store = createNotesStore({ vaultDir: dir, settleMs: 10, onChange: s => seen.push(s) });
  await store.start();
  store.stop();
  return { store, seen, read: (name: string) => Bun.file(join(dir, name)).text() };
}

const ids = (s: NotesSnapshot) => (s.kind === "ready" ? s.notes.map(n => n.id).toSorted() : s.reason);

test("indexes every markdown note in the vault except dot folders", async () => {
  const { store } = await setup({ "a.md": "[[b]]", "sub/b.md": "", ".obsidian/x.md": "", ".trash/y.md": "", "img.png": "" });
  expect(ids(store.snapshot())).toEqual(["a", "sub/b"]);
  expect(await store.read("sub/b")).toMatchObject({ id: "sub/b", text: "" });
  expect(await store.read("nope")).toBeNull();
});

test("a save writes through and republishes, and a stale save is refused untouched", async () => {
  const { store, seen, read } = await setup({ "a.md": "one" });
  expect(await store.save({ id: "a", base: "one", next: "one [[b]]" })).toEqual({ ok: true });
  expect(await read("a.md")).toBe("one [[b]]");
  expect(seen.length).toBe(2);

  expect(await store.save({ id: "a", base: "one", next: "clobber" })).toMatchObject({ ok: false, status: 409 });
  expect(await read("a.md")).toBe("one [[b]]");
});

test("create makes folders, never overwrites, and refuses paths outside the vault", async () => {
  const { store, read } = await setup({ "a.md": "keep" });
  expect(await store.create("new/deep/note")).toEqual({ ok: true });
  expect(await read("new/deep/note.md")).toBe("");
  expect(ids(store.snapshot())).toEqual(["a", "new/deep/note"]);
  expect(await store.create("a")).toMatchObject({ ok: false, status: 409 });
  expect(await store.create("../escape")).toMatchObject({ ok: false, status: 400 });
});

test("reports why notes are unavailable without a vault", async () => {
  const seen: NotesSnapshot[] = [];
  const store = createNotesStore({ vaultDir: undefined, settleMs: 10, onChange: s => seen.push(s) });
  await store.start();
  expect(store.snapshot()).toMatchObject({ kind: "unavailable" });
  expect(await store.save({ id: "a", base: "", next: "x" })).toMatchObject({ ok: false, status: 503 });
});

test("an embedded image resolves to its file in the vault, never one in a dot folder", async () => {
  const { store } = await setup({ "a.md": "![[Pasted image 1.png]]", "attachments/Pasted image 1.png": "png", ".trash/gone.png": "x", "notes.txt": "" });
  expect(store.asset("Pasted image 1.png")).toBe(join(dir, "attachments/Pasted image 1.png"));
  expect(store.asset("gone.png")).toBeNull();
  expect(store.asset("../a.md")).toBeNull();
});
