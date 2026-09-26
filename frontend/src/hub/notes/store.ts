import { watch, type FSWatcher } from "node:fs";
import { mkdir, readdir } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { NoteIdSchema, type NoteFile, type NoteHit, type NoteSave, type NotesSnapshot } from "@/shared/notes";
import { createAssetResolver, isImageTarget } from "@/shared/wikilinks";
import { buildIndex, searchNotes, type VaultFile } from "./vaultIndex";

export type NoteWrite = { ok: true } | { ok: false; status: 400 | 404 | 409 | 503; error: string };

export type NotesStoreOptions = {
  vaultDir: string | undefined;
  settleMs: number;
  onChange: (s: NotesSnapshot) => void;
};

const visible = (rel: string) => !rel.split(/[\\/]/).some(s => s.startsWith("."));
const isNotePath = (rel: string) => rel.endsWith(".md") && visible(rel);
const isImagePath = (rel: string) => isImageTarget(rel) && visible(rel);

export function createNotesStore({ vaultDir, settleMs, onChange }: NotesStoreOptions) {
  const root = vaultDir ? resolve(vaultDir) : null;
  let files: VaultFile[] = [];
  let findAsset: (target: string) => string | null = () => null;
  let snapshot: NotesSnapshot = { kind: "unavailable", reason: root ? "reading the vault" : "set MIRAI_VAULT_DIR on the hub to the Obsidian vault folder" };
  let watcher: FSWatcher | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => undefined);
    return run;
  };

  const pathOf = (id: string): string | null => {
    if (!root || !NoteIdSchema.safeParse(id).success) return null;
    const p = resolve(root, `${id}.md`);
    return p.startsWith(root + sep) ? p : null;
  };

  async function rescan(): Promise<void> {
    if (!root) return;
    try {
      const all = (await readdir(root, { recursive: true })).map(n => n.split(sep).join("/"));
      const names = all.filter(isNotePath);
      findAsset = createAssetResolver(all.filter(isImagePath));
      files = await Promise.all(
        names.map(async name => {
          const file = Bun.file(join(root, name));
          return { id: name.slice(0, -3), text: await file.text(), mtime: file.lastModified };
        }),
      );
      snapshot = { kind: "ready", notes: buildIndex(files), changedAt: Math.max(0, ...files.map(f => f.mtime)) };
    } catch (err: unknown) {
      snapshot = { kind: "unavailable", reason: err instanceof Error ? err.message : String(err) };
    }
    onChange(snapshot);
  }

  const schedule = (_event: string, name: string | null) => {
    if (name !== null && !isNotePath(name) && !isImagePath(name)) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void rescan(), settleMs);
  };

  const refuse = (id: string): NoteWrite =>
    !root ? { ok: false, status: 503, error: snapshot.kind === "unavailable" ? snapshot.reason : "notes are not ready" } : { ok: false, status: 400, error: `${id} is not a note path inside the vault` };

  return {
    snapshot: () => snapshot,

    async start() {
      if (!root) {
        onChange(snapshot);
        return;
      }
      await rescan();
      try {
        watcher = watch(root, { recursive: true }, schedule);
      } catch (err: unknown) {
        console.error(`notes: cannot watch ${root}:`, err);
      }
    },

    stop() {
      watcher?.close();
      if (timer) clearTimeout(timer);
    },

    async read(id: string): Promise<NoteFile | null> {
      const p = pathOf(id);
      if (!p) return null;
      const file = Bun.file(p);
      return (await file.exists()) ? { id, text: await file.text(), mtime: file.lastModified } : null;
    },

    search: (query: string, limit: number): NoteHit[] => searchNotes(files, query, limit),

    asset(target: string): string | null {
      const rel = findAsset(target);
      return root && rel ? join(root, rel) : null;
    },

    save: ({ id, base, next }: NoteSave): Promise<NoteWrite> =>
      serial(async () => {
        const p = pathOf(id);
        if (!p) return refuse(id);
        const file = Bun.file(p);
        if (!(await file.exists())) return { ok: false, status: 404, error: `${id}.md is gone` };
        if ((await file.text()) !== base) return { ok: false, status: 409, error: `${id}.md changed since you loaded it` };
        await Bun.write(file, next);
        await rescan();
        return { ok: true };
      }),

    create: (id: string): Promise<NoteWrite> =>
      serial(async () => {
        const p = pathOf(id);
        if (!p) return refuse(id);
        if (await Bun.file(p).exists()) return { ok: false, status: 409, error: `${id}.md already exists` };
        await mkdir(dirname(p), { recursive: true });
        await Bun.write(p, "");
        await rescan();
        return { ok: true };
      }),
  };
}

export type NotesStore = ReturnType<typeof createNotesStore>;
