import type { Embed, LaterKind } from "@/shared/later";
import { isBareXArticle, socialTarget } from "@/shared/social";

export type Classified = { kind: LaterKind; embed: Embed; site: string };

const VIDEO_FILE = /\.(mp4|webm|mov|m4v)$/i;
const YOUTUBE_ID = /^[\w-]{11}$/;
const NO_EMBED_WATCH: Readonly<Record<string, string>> = {
  "instagram.com": "instagram",
  "tiktok.com": "tiktok",
  "netflix.com": "netflix",
  "twitch.tv": "twitch",
  "primevideo.com": "prime video",
  "hotstar.com": "hotstar",
};
const NO_EMBED_READ: Readonly<Record<string, string>> = { "x.com": "x.com", "twitter.com": "x.com", "linkedin.com": "linkedin", "threads.net": "threads" };

const external = (kind: LaterKind, site: string, name: string): Classified => ({ kind, site, embed: { type: "external", reason: `${name} doesn't allow embedding` } });

function youtubeId(u: URL, host: string): string | null {
  const parts = u.pathname.split("/").filter(Boolean);
  const id = host === "youtu.be" ? parts[0] : host.endsWith("youtube.com") ? (u.searchParams.get("v") ?? (["shorts", "live", "embed"].includes(parts[0] ?? "") ? parts[1] : undefined)) : undefined;
  return id && YOUTUBE_ID.test(id) ? id : null;
}

export function classify(url: string): Classified {
  const u = new URL(url);
  const host = u.hostname.replace(/^(www|m)\./, "");
  if (socialTarget(url) || isBareXArticle(url)) return { kind: "read", site: host, embed: { type: "social" } };

  const yt = youtubeId(u, host);
  if (yt) return { kind: "watch", site: "youtube.com", embed: { type: "youtube", videoId: yt } };

  const vimeo = host === "vimeo.com" ? u.pathname.split("/").find(p => /^\d+$/.test(p)) : undefined;
  if (vimeo) return { kind: "watch", site: host, embed: { type: "vimeo", videoId: vimeo } };

  if (VIDEO_FILE.test(u.pathname)) return { kind: "watch", site: host, embed: { type: "video" } };
  if (u.pathname.toLowerCase().endsWith(".pdf") || (host === "arxiv.org" && u.pathname.startsWith("/pdf/"))) return { kind: "read", site: host, embed: { type: "pdf" } };

  const watchBlock = Object.entries(NO_EMBED_WATCH).find(([h]) => host === h || host.endsWith(`.${h}`));
  if (watchBlock) return external("watch", host, watchBlock[1]);
  const readBlock = Object.entries(NO_EMBED_READ).find(([h]) => host === h || host.endsWith(`.${h}`));
  if (readBlock) return external("read", host, readBlock[1]);

  return { kind: "read", site: host, embed: { type: "article" } };
}
