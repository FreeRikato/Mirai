import { and, desc, eq, inArray, isNull, max } from "drizzle-orm";
import { z } from "zod";
import { ChapterSchema, EmbedSchema, reslot, type Embed, type LaterFolder, type LaterItem, type LaterKind, type LaterReader, type LaterState, type Worth } from "@/shared/later";
import { isBareXArticle, socialTarget } from "@/shared/social";
import type { Db } from "../db";
import { laterFolders, laterItems } from "../db/schema";
import { identityOf } from "./identity";
import type { Ingested } from "./ingest";

type Row = typeof laterItems.$inferSelect;

const TldrSchema = z.array(z.string());
const ChaptersSchema = z.array(ChapterSchema);

function embedOf(r: Row): Embed {
  const stored = EmbedSchema.parse(JSON.parse(r.embed));
  const target = socialTarget(r.url);
  const onX = target?.kind === "tweet" || isBareXArticle(r.url);
  if (onX && stored.type === "article") return stored;
  return target || onX ? { type: "social" } : stored;
}

const toItem = (r: Row): LaterItem => ({
  id: r.id,
  url: r.url,
  kind: r.kind,
  embed: embedOf(r),
  title: r.title,
  site: r.site,
  author: r.author,
  image: r.image,
  lengthSec: r.lengthSec,
  progress: r.progress,
  position: r.position,
  state: r.state,
  worth: r.worth,
  tldr: TldrSchema.parse(JSON.parse(r.tldr)),
  chapters: ChaptersSchema.parse(JSON.parse(r.chapters)),
  folder: r.folderId === null ? null : { id: r.folderId, order: r.folderOrder },
  queueOrder: r.queueOrder,
  savedAt: r.savedAt,
});

export function stateAfterProgress(state: LaterState, progress: number): LaterState {
  if (state === "archived") return state;
  return state === "unread" && progress > 0 ? "progress" : state;
}

export function laterItem(db: Db, id: string): { item: LaterItem; content: string | null } | null {
  const r = db.select().from(laterItems).where(eq(laterItems.id, id)).get();
  return r ? { item: toItem(r), content: r.content } : null;
}

export const listLater = (db: Db): LaterItem[] => db.select().from(laterItems).orderBy(desc(laterItems.queueOrder)).all().map(toItem);

const ungrouped = (r: Row, at: number) => ({ folderId: null, folderOrder: 0, state: stateAfterProgress("unread", r.progress), worth: "unscored" as const, updatedAt: at });

export type LaterStore = ReturnType<typeof createLaterStore>;

export function createLaterStore(deps: { db: Db; ingest: (url: string) => Promise<Ingested>; aliases?: (url: string) => Promise<string[]>; now?: () => number }) {
  const { db } = deps;
  const now = deps.now ?? Date.now;
  const row = (id: string) => db.select().from(laterItems).where(eq(laterItems.id, id)).get();
  const folderExists = (id: string) => db.select({ id: laterFolders.id }).from(laterFolders).where(eq(laterFolders.id, id)).get() !== undefined;
  const nextOrder = (folderId: string) => (db.select({ top: max(laterItems.folderOrder) }).from(laterItems).where(eq(laterItems.folderId, folderId)).get()?.top ?? 0) + 1;
  const intoFolder = (folderId: string) => ({ folderId, folderOrder: nextOrder(folderId), updatedAt: now() });
  const known = (identities: readonly string[]) => (identities.length === 0 ? undefined : db.select().from(laterItems).all().find(r => identities.includes(identityOf(r.url))));

  return {
    list: (): LaterItem[] => listLater(db),

    get: (id: string): LaterItem | null => {
      const r = row(id);
      return r ? toItem(r) : null;
    },

    async save(url: string, folderId?: string): Promise<LaterItem> {
      if (folderId !== undefined && !folderExists(folderId)) throw new Error("no such folder");
      const existing = db.select().from(laterItems).where(eq(laterItems.url, url)).get() ?? known([identityOf(url)]) ?? known((await deps.aliases?.(url)) ?? []);
      if (existing && folderId !== undefined) {
        if (existing.folderId === folderId) return toItem(existing);
        const next = intoFolder(folderId);
        db.update(laterItems).set(next).where(eq(laterItems.id, existing.id)).run();
        return toItem({ ...existing, ...next });
      }
      if (existing) {
        if (existing.folderId !== null) return toItem(existing);
        if (existing.state !== "archived") return toItem(existing);
        const back = { state: "unread" as const, savedAt: now(), queueOrder: now(), updatedAt: now() };
        db.update(laterItems).set(back).where(eq(laterItems.id, existing.id)).run();
        return toItem({ ...existing, ...back });
      }
      const got = await deps.ingest(url);
      const at = now();
      const inserted = db
        .insert(laterItems)
        .values({ ...got, ...(folderId === undefined ? {} : intoFolder(folderId)), id: crypto.randomUUID(), embed: JSON.stringify(got.embed), tldr: JSON.stringify(got.tldr), chapters: JSON.stringify(got.chapters), queueOrder: at, savedAt: at, updatedAt: at })
        .onConflictDoNothing()
        .returning()
        .get();
      const r = inserted ?? db.select().from(laterItems).where(eq(laterItems.url, url)).get();
      if (!r) throw new Error(`could not save ${url}`);
      return toItem(r);
    },

    open(kind: LaterKind): { item: LaterItem; content: string | null }[] {
      return db
        .select()
        .from(laterItems)
        .where(and(eq(laterItems.kind, kind), isNull(laterItems.folderId), inArray(laterItems.state, ["unread", "progress"])))
        .orderBy(desc(laterItems.queueOrder))
        .all()
        .map(r => ({ item: toItem(r), content: r.content }));
    },

    judged(verdicts: ReadonlyMap<string, Worth>) {
      db.transaction(tx => {
        for (const [id, worth] of verdicts) tx.update(laterItems).set({ worth }).where(eq(laterItems.id, id)).run();
      });
    },

    reader(id: string): LaterReader {
      const r = row(id);
      if (!r) return { kind: "unavailable", reason: "this item no longer exists" };
      if (!r.content) return { kind: "unavailable", reason: "no reader view was extracted for this page" };
      return { kind: "ready", html: r.content, words: r.content.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length };
    },

    progress(id: string, p: { progress: number; position: number }): LaterItem | null {
      const r = row(id);
      if (!r) return null;
      const next = { progress: p.progress, position: p.position, state: stateAfterProgress(r.state, p.progress), updatedAt: now() };
      db.update(laterItems).set(next).where(eq(laterItems.id, id)).run();
      return toItem({ ...r, ...next });
    },

    retitle(id: string, meta: { title: string; author: string | null; image: string | null; site: string }): LaterItem | null {
      const r = row(id);
      if (!r) return null;
      const next = { ...meta, updatedAt: now() };
      db.update(laterItems).set(next).where(eq(laterItems.id, id)).run();
      return toItem({ ...r, ...next });
    },

    patch(id: string, p: { state?: LaterState; kind?: LaterItem["kind"] }): LaterItem | null {
      const r = row(id);
      if (!r) return null;
      const next = { state: p.state ?? r.state, kind: p.kind ?? r.kind, updatedAt: now() };
      db.update(laterItems).set(next).where(eq(laterItems.id, id)).run();
      return toItem({ ...r, ...next });
    },

    folders: (): LaterFolder[] => db.select().from(laterFolders).orderBy(laterFolders.createdAt).all(),

    createFolder(name: string): LaterFolder {
      const folder = { id: crypto.randomUUID(), name, createdAt: now() };
      db.insert(laterFolders).values(folder).run();
      return folder;
    },

    renameFolder(id: string, name: string): LaterFolder | null {
      return db.update(laterFolders).set({ name }).where(eq(laterFolders.id, id)).returning().get() ?? null;
    },

    deleteFolder(id: string): LaterItem[] {
      return db.transaction(tx => {
        const rows = tx.select().from(laterItems).where(eq(laterItems.folderId, id)).all();
        const back = rows.map(r => ({ ...r, ...ungrouped(r, now()) }));
        for (const r of back) tx.update(laterItems).set(ungrouped(r, now())).where(eq(laterItems.id, r.id)).run();
        tx.delete(laterFolders).where(eq(laterFolders.id, id)).run();
        return back.map(toItem);
      });
    },

    move(id: string, folderId: string | null): LaterItem | null {
      const r = row(id);
      if (!r || (folderId !== null && !folderExists(folderId))) return null;
      if (r.folderId === folderId) return toItem(r);
      const next = folderId === null ? ungrouped(r, now()) : intoFolder(folderId);
      db.update(laterItems).set(next).where(eq(laterItems.id, id)).run();
      return toItem({ ...r, ...next });
    },

    reorderQueue(ids: readonly string[]): void {
      db.transaction(tx => {
        const current = tx.select({ id: laterItems.id, queueOrder: laterItems.queueOrder }).from(laterItems).where(and(inArray(laterItems.id, [...ids]), isNull(laterItems.folderId))).all();
        for (const [id, queueOrder] of reslot(current, ids)) tx.update(laterItems).set({ queueOrder }).where(eq(laterItems.id, id)).run();
      });
    },

    reorder(folderId: string, ids: readonly string[]): void {
      db.transaction(tx => {
        ids.forEach((id, at) => tx.update(laterItems).set({ folderOrder: at + 1 }).where(and(eq(laterItems.id, id), eq(laterItems.folderId, folderId))).run());
      });
    },
  };
}
