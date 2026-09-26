import { z } from "zod";
import type { RankingSnapshot } from "./ranking";

export const LATER_KINDS = ["read", "watch"] as const;
export type LaterKind = (typeof LATER_KINDS)[number];
export const isLaterKind = (s: unknown): s is LaterKind => LATER_KINDS.some(k => k === s);

export const LATER_STATES = ["unread", "progress", "done", "archived"] as const;
export type LaterState = (typeof LATER_STATES)[number];

export const WORTH = ["unscored", "full", "skim", "summary", "archive"] as const;
export type Worth = (typeof WORTH)[number];
export type Verdict = Exclude<Worth, "unscored">;
export const isVerdict = (s: string): s is Verdict => s !== "unscored" && WORTH.some(w => w === s);

export const verdictLabel = (verdict: Verdict, kind: LaterKind): string => ({ full: `${kind} fully`, skim: "skim", summary: "summary is enough", archive: "archive" })[verdict];

export const WORTH_REASONS = ["ship now", "deep skill", "landscape", "career", "fun", "stale"] as const;
export type WorthReason = (typeof WORTH_REASONS)[number];
export const isWorthReason = (s: string): s is WorthReason => WORTH_REASONS.some(r => r === s);

export const WorthItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  score: z.number(),
  reason: z.enum(WORTH_REASONS),
  verdict: z.enum(["full", "skim", "summary", "archive"]),
  evidence: z.array(z.string()),
});
export type WorthItem = z.infer<typeof WorthItemSchema>;
export type WorthSnapshot = RankingSnapshot<WorthItem>;

export const EmbedSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("article") }),
  z.object({ type: z.literal("pdf") }),
  z.object({ type: z.literal("youtube"), videoId: z.string() }),
  z.object({ type: z.literal("vimeo"), videoId: z.string() }),
  z.object({ type: z.literal("video") }),
  z.object({ type: z.literal("external"), reason: z.string() }),
  z.object({ type: z.literal("social") }),
]);
export type Embed = z.infer<typeof EmbedSchema>;

export const ChapterSchema = z.object({ at: z.number().nonnegative(), title: z.string() });
export type Chapter = z.infer<typeof ChapterSchema>;

export type LaterItem = {
  id: string;
  url: string;
  kind: LaterKind;
  embed: Embed;
  title: string;
  site: string;
  author: string | null;
  image: string | null;
  lengthSec: number | null;
  progress: number;
  position: number;
  state: LaterState;
  worth: Worth;
  tldr: string[];
  chapters: Chapter[];
  folder: { id: string; order: number } | null;
  queueOrder: number;
  savedAt: number;
};

export const byQueueOrder = (a: Pick<LaterItem, "queueOrder">, b: Pick<LaterItem, "queueOrder">) => b.queueOrder - a.queueOrder;

export function reslot(current: readonly Pick<LaterItem, "id" | "queueOrder">[], ids: readonly string[]): Map<string, number> {
  const wanted = new Set(ids);
  const slots = current
    .filter(i => wanted.has(i.id))
    .map(i => i.queueOrder)
    .sort((a, b) => b - a);
  const known = ids.filter(id => current.some(i => i.id === id));
  return new Map(known.map((id, n) => [id, slots[n] ?? 0]));
}

export type LaterFolder = { id: string; name: string; createdAt: number };

export const SegmentSchema = z.object({ start: z.number().nonnegative(), end: z.number().nonnegative(), text: z.string() });
export type Segment = z.infer<typeof SegmentSchema>;
export const ASR_STAGES = ["downloading", "transcribing"] as const;
export const AsrProgressSchema = z.object({ stage: z.enum(ASR_STAGES), done: z.number().nonnegative(), total: z.number().nonnegative() });
export type AsrProgress = z.infer<typeof AsrProgressSchema>;

export type Transcript =
  | { status: "unsupported" }
  | { status: "queued" }
  | { status: "running"; progress: AsrProgress | null; segments: Segment[] }
  | { status: "ready"; model: string; segments: Segment[] }
  | { status: "failed"; error: string; retryAt: number | null };

export const SKIP_CATEGORIES = ["sponsor", "selfpromo", "interaction", "intro", "outro"] as const;
export type SkipCategory = (typeof SKIP_CATEGORIES)[number];
export const isSkipCategory = (s: string): s is SkipCategory => SKIP_CATEGORIES.some(c => c === s);
export const SKIP_LABEL: Record<SkipCategory, string> = { sponsor: "sponsor", selfpromo: "self promo", interaction: "subscribe reminder", intro: "intro", outro: "outro" };
export type Skip = { start: number; end: number; category: SkipCategory };

export type LaterReader = { kind: "ready"; html: string; words: number } | { kind: "unavailable"; reason: string };

const PLAYLIST_ID = /^[\w-]+$/;

export function youtubePlaylistId(url: string): string | null {
  const u = URL.parse(url);
  if (!u || !["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"].includes(u.hostname) || u.pathname !== "/playlist") return null;
  const list = u.searchParams.get("list");
  return list && PLAYLIST_ID.test(list) ? list : null;
}

export type SaveOutcome = { saved: LaterItem[]; failed: { url: string; error: string }[] };

export const SaveSchema = z.object({ url: z.url({ protocol: /^https?$/ }), folderId: z.string().min(1).optional() });
export const FolderNameSchema = z.object({ name: z.string().trim().min(1).max(80) });
export const MoveSchema = z.object({ folderId: z.string().min(1).nullable() });
export const FolderOrderSchema = z.object({ ids: z.array(z.string().min(1)) });
export const ProgressSchema = z.object({ progress: z.number().min(0).max(1), position: z.number().nonnegative() });
export const PatchSchema = z.object({ state: z.enum(LATER_STATES).optional(), kind: z.enum(LATER_KINDS).optional() }).refine(p => p.state !== undefined || p.kind !== undefined, "state or kind");
export const SendSchema = z.object({ machine: z.string().min(1) });
export const OpenUrlSchema = z.object({ url: z.url({ protocol: /^https?$/ }) });

export const HighlightAnchorSchema = z.object({ quote: z.string().trim().min(1).max(2000), prefix: z.string().max(200), suffix: z.string().max(200) });
export type HighlightAnchor = z.infer<typeof HighlightAnchorSchema>;
export const NewHighlightSchema = HighlightAnchorSchema.extend({ note: z.string().max(4000), at: z.number().nonnegative().optional() });
export type NewHighlight = z.infer<typeof NewHighlightSchema>;
export const HighlightNoteSchema = z.object({ note: z.string().max(4000) });
export type Highlight = HighlightAnchor & { id: string; itemId: string; note: string; at: number | null; createdAt: number };
