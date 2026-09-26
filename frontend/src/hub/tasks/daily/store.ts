import { watch, type FSWatcher } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { LocalBlockEdit, LocalMove, LocalSnapshot, LocalTask, DailyNote } from "@/shared/tasks";
import { carryOver, parseNote, replaceBlock, setState, type Edit } from "./note";
import { dailyNotesDir } from "./vault";

const NOTE_FILE = /^(\d{4}-\d{2}-\d{2})\.md$/;

export type WriteResult = { ok: true } | { ok: false; status: 404 | 409 | 503; error: string };

const pad = (n: number) => String(n).padStart(2, "0");
export const localDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export type DailyStoreOptions = {
  vaultDir: string | undefined;
  carryDays: number;
  settleMs: number;
  onChange: (s: LocalSnapshot) => void;
  today?: () => string;
};

export function createDailyStore({ vaultDir, carryDays, settleMs, onChange, today = localDate }: DailyStoreOptions) {
  let dir: string | null = null;
  let snapshot: LocalSnapshot = { kind: "unavailable", reason: "reading the vault" };
  let watcher: FSWatcher | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => undefined);
    return run;
  };

  const path = (notes: string, date: string) => join(notes, `${date}.md`);

  async function readAll(notes: string): Promise<{ date: string; text: string; modified: number }[]> {
    const names = await readdir(notes);
    const dates = names.flatMap(n => NOTE_FILE.exec(n)?.[1] ?? []).toSorted();
    return Promise.all(
      dates.map(async date => {
        const file = Bun.file(path(notes, date));
        return { date, text: await file.text(), modified: file.lastModified };
      }),
    );
  }

  async function rescan(): Promise<void> {
    if (!dir) return;
    try {
      const files = await readAll(dir);
      const notes: DailyNote[] = [];
      const tasks: LocalTask[] = [];
      for (const f of files) {
        const parsed = parseNote(f.date, f.text);
        notes.push({ date: f.date, counts: parsed.counts });
        tasks.push(...parsed.tasks);
      }
      const changedAt = Math.max(0, ...files.map(f => f.modified));
      snapshot = { kind: "ready", today: today(), notes: notes.toReversed(), tasks, changedAt };
    } catch (err: unknown) {
      snapshot = { kind: "unavailable", reason: err instanceof Error ? err.message : String(err) };
    }
    onChange(snapshot);
  }

  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void rescan(), settleMs);
  };

  const unavailable = (): WriteResult => ({ ok: false, status: 503, error: snapshot.kind === "unavailable" ? snapshot.reason : "daily notes are not ready" });

  async function rewrite(date: string, edit: (text: string) => Edit): Promise<WriteResult> {
    return serial(async () => {
      if (!dir) return unavailable();
      const file = Bun.file(path(dir, date));
      if (!(await file.exists())) return { ok: false, status: 404, error: `${date}.md is gone` };
      const out = edit(await file.text());
      if (!out.ok) return { ok: false, status: 409, error: `${date}.md changed since you loaded it` };
      await Bun.write(file, out.text);
      await rescan();
      return { ok: true };
    });
  }

  return {
    snapshot: () => snapshot,

    async start() {
      const found = await dailyNotesDir(vaultDir);
      if (!found.ok) {
        snapshot = { kind: "unavailable", reason: found.reason };
        onChange(snapshot);
        return;
      }
      dir = found.dir;
      await rescan();
      try {
        watcher = watch(dir, schedule);
      } catch (err: unknown) {
        console.error(`tasks: cannot watch ${dir}:`, err);
      }
    },

    stop() {
      watcher?.close();
      if (timer) clearTimeout(timer);
    },

    move: (m: LocalMove) => rewrite(m.date, text => setState(text, m.line, m.raw, m.to)),

    editBlock: (e: LocalBlockEdit) => rewrite(e.date, text => replaceBlock(text, e.line, e.block, e.next)),

    createToday: (): Promise<WriteResult> =>
      serial(async () => {
        if (!dir) return unavailable();
        const date = today();
        if (await Bun.file(path(dir, date)).exists()) return { ok: false, status: 409, error: `${date}.md already exists` };
        const out = carryOver(await readAll(dir), date, carryDays);
        await Bun.write(path(dir, date), out.today ? `${out.today}\n` : "");
        for (const u of out.updated) await Bun.write(path(dir, u.date), u.text);
        await rescan();
        return { ok: true };
      }),
  };
}

export type DailyStore = ReturnType<typeof createDailyStore>;
