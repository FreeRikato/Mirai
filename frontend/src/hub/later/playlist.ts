import type { LaterItem, SaveOutcome } from "@/shared/later";

export type ListPlaylist = (listId: string) => Promise<string[]>;

const VIDEO_ID = /^[\w-]{11}$/;

export function createPlaylistLister(config: { bin: string; timeoutMs: number }): ListPlaylist {
  return async listId => {
    const proc = Bun.spawn([config.bin, "--flat-playlist", "--print", "id", `https://www.youtube.com/playlist?list=${listId}`], { stdout: "pipe", stderr: "pipe", timeout: config.timeoutMs, killSignal: "SIGKILL" });
    const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    if (proc.signalCode === "SIGKILL") throw new Error(`listing the playlist timed out after ${config.timeoutMs}ms`);
    if (code !== 0) throw new Error(err.split("\n").filter(l => l.trim() !== "").at(-1) ?? `yt-dlp exited with ${code}`);
    const ids = [...new Set(out.split("\n").map(l => l.trim()).filter(l => VIDEO_ID.test(l)))];
    if (ids.length === 0) throw new Error("the playlist has no videos");
    return ids;
  };
}

async function eachLimited<T, R>(items: readonly T[], limit: number, run: (item: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const out: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const at = next++;
      const item = items[at] as T;
      out[at] = await run(item).then(
        value => ({ status: "fulfilled", value }) as const,
        (reason: unknown) => ({ status: "rejected", reason }) as const,
      );
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export type PlaylistDeps = {
  list: ListPlaylist;
  save: (url: string, folderId?: string) => Promise<LaterItem>;
  folderIds: (folderId: string) => string[];
  reorder: (folderId: string, ids: readonly string[]) => void;
  parallel: number;
};

export async function savePlaylist(deps: PlaylistDeps, listId: string, folderId?: string): Promise<SaveOutcome> {
  const urls = (await deps.list(listId)).map(id => `https://www.youtube.com/watch?v=${id}`);
  const settled = await eachLimited(urls, deps.parallel, url => deps.save(url, folderId));
  const out = settled.reduce<SaveOutcome>(
    (acc, s, n) => (s.status === "fulfilled" ? { ...acc, saved: [...acc.saved, s.value] } : { ...acc, failed: [...acc.failed, { url: urls[n] ?? "", error: s.reason instanceof Error ? s.reason.message : String(s.reason) }] }),
    { saved: [], failed: [] },
  );
  if (folderId !== undefined) {
    const added = out.saved.map(i => i.id);
    deps.reorder(folderId, [...deps.folderIds(folderId).filter(id => !added.includes(id)), ...added]);
  }
  return out;
}
