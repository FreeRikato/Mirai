import { asc, eq } from "drizzle-orm";
import type { Highlight, NewHighlight } from "@/shared/later";
import type { Db } from "../db";
import { laterHighlights } from "../db/schema";

type Row = typeof laterHighlights.$inferSelect;

const toHighlight = (r: Row): Highlight => ({ id: r.id, itemId: r.itemId, quote: r.quote, prefix: r.prefix, suffix: r.suffix, note: r.note, at: r.at, createdAt: r.createdAt });

export function createHighlights({ db, now = Date.now }: { db: Db; now?: () => number }) {
  const byId = (id: string) => db.select().from(laterHighlights).where(eq(laterHighlights.id, id)).get();
  return {
    list: (itemId: string): Highlight[] => db.select().from(laterHighlights).where(eq(laterHighlights.itemId, itemId)).orderBy(asc(laterHighlights.createdAt)).all().map(toHighlight),

    add(itemId: string, h: NewHighlight): Highlight {
      const row = { id: crypto.randomUUID(), itemId, ...h, note: h.note.trim(), at: h.at ?? null, createdAt: now() };
      db.insert(laterHighlights).values(row).run();
      return toHighlight(row);
    },

    setNote(id: string, note: string): Highlight | null {
      const r = byId(id);
      if (!r) return null;
      db.update(laterHighlights).set({ note: note.trim() }).where(eq(laterHighlights.id, id)).run();
      return toHighlight({ ...r, note: note.trim() });
    },

    remove(id: string): boolean {
      return db.delete(laterHighlights).where(eq(laterHighlights.id, id)).returning().all().length > 0;
    },
  };
}
