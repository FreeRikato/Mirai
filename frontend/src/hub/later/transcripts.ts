import { and, asc, eq, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { EmbedSchema, SegmentSchema, type AsrProgress, type Segment, type Transcript } from "@/shared/later";
import type { Db } from "../db";
import { laterItems, laterTranscripts } from "../db/schema";
import type { AsrSession, StartAsr } from "./asr";

type Row = typeof laterTranscripts.$inferSelect;

const SegmentsSchema = z.array(SegmentSchema);
const BACKOFF = 6;

type Live = { progress: AsrProgress | null; segments: Segment[] };

const toTranscript = (r: Row, live: Live | undefined): Transcript => {
  switch (r.status) {
    case "queued":
      return { status: "queued" };
    case "running":
      return { status: "running", progress: live?.progress ?? null, segments: [...(live?.segments ?? [])] };
    case "ready":
      return { status: "ready", model: r.model ?? "", segments: SegmentsSchema.parse(JSON.parse(r.segments ?? "[]")) };
    case "failed":
      return { status: "failed", error: r.error ?? "", retryAt: r.retryAt };
  }
};

export function readySegments(db: Db, videoId: string): Segment[] | null {
  const r = db.select().from(laterTranscripts).where(eq(laterTranscripts.videoId, videoId)).get();
  return r?.status === "ready" ? SegmentsSchema.parse(JSON.parse(r.segments ?? "[]")) : null;
}

export type Transcripts = ReturnType<typeof createTranscripts>;

export function createTranscripts(deps: { db: Db; start: StartAsr; now?: () => number; maxAttempts: number; retryMs: number }) {
  const { db } = deps;
  const now = deps.now ?? Date.now;
  const row = (videoId: string) => db.select().from(laterTranscripts).where(eq(laterTranscripts.videoId, videoId)).get();
  const set = (videoId: string, change: Partial<Row>) => db.update(laterTranscripts).set({ ...change, updatedAt: now() }).where(eq(laterTranscripts.videoId, videoId)).run();

  const savedVideos = () =>
    db
      .select({ embed: laterItems.embed })
      .from(laterItems)
      .where(sql`json_extract(${laterItems.embed}, '$.type') = 'youtube'`)
      .orderBy(asc(laterItems.savedAt))
      .all()
      .flatMap(r => {
        const embed = EmbedSchema.parse(JSON.parse(r.embed));
        return embed.type === "youtube" ? [embed.videoId] : [];
      });

  const queueNew = () => {
    for (const videoId of savedVideos()) db.insert(laterTranscripts).values({ videoId, status: "queued", queuedAt: now(), updatedAt: now() }).onConflictDoNothing().run();
  };

  db.update(laterTranscripts).set({ status: "queued", updatedAt: now() }).where(eq(laterTranscripts.status, "running")).run();
  let busy = false;
  const live = new Map<string, Live>();

  const next = () =>
    db
      .select()
      .from(laterTranscripts)
      .where(or(eq(laterTranscripts.status, "queued"), and(eq(laterTranscripts.status, "failed"), lte(laterTranscripts.retryAt, now()))))
      .orderBy(asc(laterTranscripts.queuedAt))
      .get();

  const failed = (job: Row, err: unknown) => {
    const attempts = job.attempts + 1;
    const retryAt = attempts < deps.maxAttempts ? now() + deps.retryMs * BACKOFF ** (attempts - 1) : null;
    set(job.videoId, { status: "failed", attempts, retryAt, error: err instanceof Error ? err.message : String(err) });
  };

  const transcribeOne = async (session: AsrSession, job: Row): Promise<boolean> => {
    const heardSoFar: Live = { progress: null, segments: [] };
    live.set(job.videoId, heardSoFar);
    try {
      set(job.videoId, { status: "running" });
      const heard = await session.transcribe(job.videoId, {
        progress: p => {
          heardSoFar.progress = p;
        },
        segments: s => {
          heardSoFar.segments.push(...s);
        },
      });
      set(job.videoId, { status: "ready", model: heard.model, segments: JSON.stringify(heardSoFar.segments), error: null, retryAt: null });
      return true;
    } catch (err: unknown) {
      failed(job, err);
      return false;
    } finally {
      live.delete(job.videoId);
    }
  };

  return {
    get: (videoId: string): Transcript => {
      const r = row(videoId);
      return r ? toTranscript(r, live.get(videoId)) : { status: "queued" };
    },

    retry(videoId: string) {
      set(videoId, { status: "queued", attempts: 0, retryAt: null, error: null });
    },

    async tick() {
      if (busy) return;
      queueNew();
      let job = next();
      if (!job) return;
      busy = true;
      const session = deps.start();
      try {
        while (job && (await transcribeOne(session, job))) {
          queueNew();
          job = next();
        }
      } finally {
        await session.close();
        busy = false;
      }
    },
  };
}
