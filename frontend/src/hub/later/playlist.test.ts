import { afterAll, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LaterItem } from "@/shared/later";
import { createPlaylistLister, savePlaylist, type PlaylistDeps } from "./playlist";

const dir = mkdtempSync(join(tmpdir(), "mirai-playlist-test-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function fakeBin(name: string, script: string): string {
  const path = join(dir, name);
  writeFileSync(path, `#!/usr/bin/env bash\n${script}\n`);
  chmodSync(path, 0o755);
  return path;
}

test("lists the video ids of a playlist in order, once each", async () => {
  const bin = fakeBin("ok", `[ "$4" = "https://www.youtube.com/playlist?list=PLx" ] || exit 9; echo "WARNING: noise" >&2; printf 'iXjtJmUQBZk\\n4ynrGLIuPv4\\n[private video]\\niXjtJmUQBZk\\n'`);
  expect(await createPlaylistLister({ bin, timeoutMs: 5_000 })("PLx")).toEqual(["iXjtJmUQBZk", "4ynrGLIuPv4"]);
});

test("a failing or empty listing rejects with a readable reason", async () => {
  await expect(createPlaylistLister({ bin: fakeBin("fail", `echo "ERROR: [youtube:tab] PLx: The playlist does not exist." >&2; exit 1`), timeoutMs: 5_000 })("PLx")).rejects.toThrow("The playlist does not exist.");
  await expect(createPlaylistLister({ bin: fakeBin("empty", "true"), timeoutMs: 5_000 })("PLx")).rejects.toThrow("no videos");
});

const item = (id: string, url: string): LaterItem => ({ id, url, kind: "watch", embed: { type: "youtube", videoId: id }, title: id, site: "youtube.com", author: null, image: null, lengthSec: null, progress: 0, position: 0, state: "unread", worth: "unscored", tldr: [], chapters: [], folder: null, queueOrder: 0, savedAt: 0 });

function deps(ids: string[], over: Partial<PlaylistDeps> = {}) {
  const reorders: { folderId: string; ids: readonly string[] }[] = [];
  const d: PlaylistDeps = {
    list: async () => ids,
    save: async url => {
      const id = new URL(url).searchParams.get("v") ?? "";
      await Bun.sleep(id === "aaaaaaaaaaa" ? 20 : 0);
      if (id === "bad________") throw new Error("gone");
      return item(id, url);
    },
    folderIds: () => ["old", "bbbbbbbbbbb"],
    reorder: (folderId, next) => reorders.push({ folderId, ids: next }),
    parallel: 2,
    ...over,
  };
  return { d, reorders };
}

test("saves every video as its own item and reports the ones that failed", async () => {
  const { d, reorders } = deps(["aaaaaaaaaaa", "bad________", "bbbbbbbbbbb"]);
  const out = await savePlaylist(d, "PLx");
  expect(out.saved.map(i => i.id)).toEqual(["aaaaaaaaaaa", "bbbbbbbbbbb"]);
  expect(out.failed).toEqual([{ url: "https://www.youtube.com/watch?v=bad________", error: "gone" }]);
  expect(reorders).toEqual([]);
});

test("in a folder the videos keep the playlist order after what the folder already held", async () => {
  const { d, reorders } = deps(["aaaaaaaaaaa", "bbbbbbbbbbb", "ccccccccccc"]);
  await savePlaylist(d, "PLx", "f1");
  expect(reorders).toEqual([{ folderId: "f1", ids: ["old", "aaaaaaaaaaa", "bbbbbbbbbbb", "ccccccccccc"] }]);
});
