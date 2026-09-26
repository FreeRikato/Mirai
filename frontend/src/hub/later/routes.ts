import type { BunRequest } from "bun";
import { z } from "zod";
import { FolderNameSchema, FolderOrderSchema, HighlightNoteSchema, isLaterKind, MoveSchema, NewHighlightSchema, PatchSchema, ProgressSchema, SaveSchema, SendSchema, WorthItemSchema, type LaterItem, type Transcript, youtubePlaylistId } from "@/shared/later";
import { isBareXArticle, isProxiedMedia, socialTarget } from "@/shared/social";
import type { Config } from "../config";
import type { Db } from "../db";
import { readWrite } from "../http";
import { createJev } from "../jev";
import type { AgentReply } from "../poller";
import { createRankingStore, RANKING_ROWS } from "../ranking";
import { createAsr } from "./asr";
import { createHighlights } from "./highlights";
import { tweetAliases } from "./identity";
import { httpFetcher, ingest } from "./ingest";
import { createPlaylistLister, savePlaylist } from "./playlist";
import { createSkips } from "./skips";
import { createSocial } from "./social";
import { createLaterStore } from "./store";
import { createTranscripts } from "./transcripts";
import { createWorth, type CurrentWork } from "./worth";

type WithId = BunRequest<"/api/later/:id">;
type WithHighlight = BunRequest<"/api/later-highlights/:hid">;
type WithKind = BunRequest<"/api/later-worth/:kind">;
type WithFolder<P extends string> = BunRequest<`/api/later-folders/:fid/${P}`>;

const PLAYLIST_PARALLEL = 4;
const SKIPS_TTL_MS = 6 * 3_600_000;

const missing = () => Response.json({ error: "no such item" }, { status: 404 });
const itemOr404 = (item: LaterItem | null) => (item ? Response.json(item) : missing());
const noFolder = () => Response.json({ error: "no such folder" }, { status: 404 });

export type LaterDeps = {
  db: Db;
  config: Config["later"];
  ranking: Config["tasks"]["priority"];
  work: () => Promise<CurrentWork>;
  openOn: (machine: string, url: string) => Promise<AgentReply>;
};

export function createLaterRoutes(deps: LaterDeps) {
  const fetchText = httpFetcher(deps.config.fetchTimeoutMs);
  const social = createSocial({ redditSession: deps.config.redditSession, timeoutMs: deps.config.fetchTimeoutMs, savedUrls: () => store.list().map(i => i.url) });
  const highlights = createHighlights({ db: deps.db });
  const aliases = async (url: string): Promise<string[]> => {
    if (socialTarget(url)?.kind !== "tweet" && !isBareXArticle(url)) return [];
    const s = await social(url);
    return s.kind === "tweet" ? tweetAliases(s.tweet) : [];
  };
  const store = createLaterStore({ db: deps.db, ingest: url => ingest(url, fetchText, deps.config.wpm, social), aliases });
  const { jev, profile, batch, shown } = deps.ranking;
  const worth = createWorth({
    jev: jev && createJev(jev),
    saved: {
      read: createRankingStore(deps.db, RANKING_ROWS.laterRead, WorthItemSchema),
      watch: createRankingStore(deps.db, RANKING_ROWS.laterWatch, WorthItemSchema),
    },
    open: kind => store.open(kind),
    judged: verdicts => store.judged(verdicts),
    work: deps.work,
    profile,
    batch,
    shown,
  });
  const scoreInBackground = (item: LaterItem) => {
    if (item.folder) return;
    worth.scoreSaved(item).catch((err: unknown) => console.warn("later: scoring a saved item failed", err instanceof Error ? err.message : err));
  };
  const asr = deps.config.asr;
  const transcripts = asr.bin ? createTranscripts({ db: deps.db, start: createAsr({ bin: asr.bin, timeoutMs: asr.timeoutMs }), maxAttempts: asr.maxAttempts, retryMs: asr.retryMs }) : null;
  const transcribeSoon = () => {
    transcripts?.tick().catch((err: unknown) => console.warn("later: transcribing failed", err instanceof Error ? err.message : err));
  };
  if (transcripts) {
    transcribeSoon();
    setInterval(transcribeSoon, asr.pollMs);
  }
  const transcriptOf = (item: LaterItem): Transcript => (transcripts && item.embed.type === "youtube" ? transcripts.get(item.embed.videoId) : { status: "unsupported" });
  const playlist = {
    list: createPlaylistLister({ bin: deps.config.ytdlpBin, timeoutMs: deps.config.fetchTimeoutMs * 3 }),
    save: (url: string, folderId?: string) => store.save(url, folderId),
    folderIds: (folderId: string) => store.list().filter(i => i.folder?.id === folderId).sort((a, b) => (a.folder?.order ?? 0) - (b.folder?.order ?? 0)).map(i => i.id),
    reorder: (folderId: string, ids: readonly string[]) => store.reorder(folderId, ids),
    parallel: PLAYLIST_PARALLEL,
  };
  const skips = createSkips({ fetchText, ttlMs: SKIPS_TTL_MS });
  const badKind = () => Response.json({ error: "kind must be read or watch" }, { status: 400 });

  return {
    "/api/later": {
      GET: () => Response.json(store.list()),
      POST: async (req: Request) => {
        const r = await readWrite(req, SaveSchema, "{ url } with an http(s) url");
        if (!r.ok) return r.res;
        const { url, folderId } = r.body;
        if (folderId !== undefined && !store.folders().some(f => f.id === folderId)) return noFolder();
        const item = await store.save(url, folderId);
        scoreInBackground(item);
        transcribeSoon();
        return Response.json(item, { status: 201 });
      },
    },
    "/api/later-playlist": {
      POST: async (req: Request) => {
        const r = await readWrite(req, SaveSchema, "{ url } with a youtube playlist url");
        if (!r.ok) return r.res;
        const { url, folderId } = r.body;
        const listId = youtubePlaylistId(url);
        if (!listId) return Response.json({ error: "not a youtube playlist url" }, { status: 400 });
        if (folderId !== undefined && !store.folders().some(f => f.id === folderId)) return noFolder();
        const out = await savePlaylist(playlist, listId, folderId).catch((e: unknown) => (e instanceof Error ? e : new Error(String(e))));
        if (out instanceof Error) return Response.json({ error: out.message }, { status: 502 });
        out.saved.forEach(scoreInBackground);
        transcribeSoon();
        return Response.json(out, { status: 201 });
      },
    },
    "/api/later-folders": {
      GET: () => Response.json(store.folders()),
      POST: async (req: Request) => {
        const r = await readWrite(req, FolderNameSchema, "{ name }");
        return r.ok ? Response.json(store.createFolder(r.body.name), { status: 201 }) : r.res;
      },
    },
    "/api/later-folders/:fid/rename": {
      POST: async (req: WithFolder<"rename">) => {
        const r = await readWrite(req, FolderNameSchema, "{ name }");
        if (!r.ok) return r.res;
        const folder = store.renameFolder(req.params.fid, r.body.name);
        return folder ? Response.json(folder) : noFolder();
      },
    },
    "/api/later-folders/:fid/delete": {
      POST: async (req: WithFolder<"delete">) => {
        const r = await readWrite(req, z.object({}), "{}");
        if (!r.ok) return r.res;
        if (!store.folders().some(f => f.id === req.params.fid)) return noFolder();
        const back = store.deleteFolder(req.params.fid);
        back.forEach(scoreInBackground);
        return Response.json(back);
      },
    },
    "/api/later-queue/order": {
      POST: async (req: Request) => {
        const r = await readWrite(req, FolderOrderSchema, "{ ids }");
        if (!r.ok) return r.res;
        store.reorderQueue(r.body.ids);
        return Response.json({ ok: true });
      },
    },
    "/api/later-folders/:fid/order": {
      POST: async (req: WithFolder<"order">) => {
        const r = await readWrite(req, FolderOrderSchema, "{ ids }");
        if (!r.ok) return r.res;
        if (!store.folders().some(f => f.id === req.params.fid)) return noFolder();
        store.reorder(req.params.fid, r.body.ids);
        return Response.json({ ok: true });
      },
    },
    "/api/later/:id/folder": {
      POST: async (req: WithId) => {
        const r = await readWrite(req, MoveSchema, "{ folderId } with a folder id or null");
        if (!r.ok) return r.res;
        const item = store.move(req.params.id, r.body.folderId);
        if (item) scoreInBackground(item);
        return item ? Response.json(item) : Response.json({ error: "no such item or folder" }, { status: 404 });
      },
    },
    "/api/later-worth/:kind": (req: WithKind) => (isLaterKind(req.params.kind) ? worth.rankers[req.params.kind].snapshot().then(s => Response.json(s)) : badKind()),
    "/api/later-worth/:kind/refresh": {
      POST: async (req: BunRequest<"/api/later-worth/:kind/refresh">) => {
        const { kind } = req.params;
        if (!isLaterKind(kind)) return badKind();
        const r = await readWrite(req, z.object({}), "{}");
        return r.ok ? Response.json(await worth.rankers[kind].refresh()) : r.res;
      },
    },
    "/api/later/:id/transcript": (req: WithId) => {
      const item = store.get(req.params.id);
      return item ? Response.json(transcriptOf(item)) : missing();
    },
    "/api/later/:id/skips": async (req: WithId) => {
      const item = store.get(req.params.id);
      if (!item) return missing();
      return Response.json(item.embed.type === "youtube" ? await skips(item.embed.videoId) : []);
    },
    "/api/later/:id/transcript/retry": {
      POST: async (req: BunRequest<"/api/later/:id/transcript/retry">) => {
        const r = await readWrite(req, z.object({}), "{}");
        if (!r.ok) return r.res;
        const item = store.get(req.params.id);
        if (!item) return missing();
        if (transcripts && item.embed.type === "youtube") transcripts.retry(item.embed.videoId);
        transcribeSoon();
        return Response.json(transcriptOf(item));
      },
    },
    "/api/later/:id/reader": (req: WithId) => Response.json(store.reader(req.params.id)),
    "/api/later/media": async (req: Request) => {
      const url = new URL(req.url).searchParams.get("url") ?? "";
      if (!isProxiedMedia(url)) return Response.json({ error: "only video.twimg.com media is proxied" }, { status: 400 });
      const range = req.headers.get("range");
      const res = await fetch(url, { headers: range ? { range } : {}, signal: AbortSignal.timeout(deps.config.fetchTimeoutMs) }).catch(() => null);
      if (!res?.body) return Response.json({ error: "the media could not be fetched" }, { status: 502 });
      const headers = new Headers({ "cache-control": "private, max-age=3600" });
      for (const h of ["content-type", "content-length", "content-range", "accept-ranges"]) {
        const v = res.headers.get(h);
        if (v) headers.set(h, v);
      }
      return new Response(res.body, { status: res.status, headers });
    },
    "/api/later/:id/highlights": {
      GET: (req: WithId) => (store.get(req.params.id) ? Response.json(highlights.list(req.params.id)) : missing()),
      POST: async (req: WithId) => {
        const r = await readWrite(req, NewHighlightSchema, "{ quote, prefix, suffix, note }");
        if (!r.ok) return r.res;
        return store.get(req.params.id) ? Response.json(highlights.add(req.params.id, r.body), { status: 201 }) : missing();
      },
    },
    "/api/later-highlights/:hid/note": {
      POST: async (req: WithHighlight) => {
        const r = await readWrite(req, HighlightNoteSchema, "{ note }");
        if (!r.ok) return r.res;
        const updated = highlights.setNote(req.params.hid, r.body.note);
        return updated ? Response.json(updated) : Response.json({ error: "no such highlight" }, { status: 404 });
      },
    },
    "/api/later-highlights/:hid/delete": {
      POST: async (req: WithHighlight) => {
        const r = await readWrite(req, z.object({}), "{}");
        if (!r.ok) return r.res;
        return highlights.remove(req.params.hid) ? Response.json({ ok: true }) : Response.json({ error: "no such highlight" }, { status: 404 });
      },
    },
    "/api/later/:id/social": async (req: WithId) => {
      const item = store.get(req.params.id);
      if (!item) return missing();
      const s = await social(item.url);
      const article = s.kind === "tweet" ? s.tweet.article : null;
      if (s.kind === "tweet" && article && isBareXArticle(item.url) && item.title !== article.title) {
        store.retitle(item.id, { title: article.title, author: `@${s.tweet.author.handle}`, image: article.cover ?? s.tweet.author.avatar, site: "x.com" });
      }
      return Response.json(s);
    },
    "/api/later/:id/pdf": async (req: WithId) => {
      const item = store.get(req.params.id);
      if (!item || item.embed.type !== "pdf") return missing();
      const res = await fetch(item.url, { signal: AbortSignal.timeout(deps.config.fetchTimeoutMs) }).catch(() => null);
      if (!res?.ok || !res.body) return Response.json({ error: "the pdf could not be fetched" }, { status: 502 });
      return new Response(res.body, { headers: { "content-type": "application/pdf", "cache-control": "private, max-age=3600" } });
    },
    "/api/later/:id/progress": {
      POST: async (req: WithId) => {
        const r = await readWrite(req, ProgressSchema, "{ progress, position }");
        return r.ok ? itemOr404(store.progress(req.params.id, r.body)) : r.res;
      },
    },
    "/api/later/:id/update": {
      POST: async (req: WithId) => {
        const r = await readWrite(req, PatchSchema, "{ state?, kind? }");
        return r.ok ? itemOr404(store.patch(req.params.id, r.body)) : r.res;
      },
    },
    "/api/later/:id/send": {
      POST: async (req: WithId) => {
        const r = await readWrite(req, SendSchema, "{ machine }");
        if (!r.ok) return r.res;
        const item = store.get(req.params.id);
        if (!item) return missing();
        const out = await deps.openOn(r.body.machine, item.url);
        return Response.json(out.body, { status: out.status });
      },
    },
  };
}
