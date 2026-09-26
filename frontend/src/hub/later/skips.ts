import { z } from "zod";
import { isSkipCategory, SKIP_CATEGORIES, type Skip } from "@/shared/later";
import type { FetchText } from "./ingest";

const SegmentsSchema = z.array(z.object({ category: z.string(), actionType: z.string(), segment: z.tuple([z.number(), z.number()]) }));

const json = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

export function merged(skips: readonly Skip[]): Skip[] {
  return [...skips]
    .sort((a, b) => a.start - b.start)
    .reduce<Skip[]>((out, s) => {
      const last = out.at(-1);
      if (last && s.start <= last.end) return [...out.slice(0, -1), { ...last, end: Math.max(last.end, s.end) }];
      return [...out, s];
    }, []);
}

export function createSkips(deps: { fetchText: FetchText; ttlMs: number; now?: () => number }) {
  const now = deps.now ?? Date.now;
  const cache = new Map<string, { at: number; skips: Skip[] }>();
  const categories = encodeURIComponent(JSON.stringify(SKIP_CATEGORIES));
  return async (videoId: string): Promise<Skip[]> => {
    const hit = cache.get(videoId);
    if (hit && now() - hit.at < deps.ttlMs) return hit.skips;
    const res = await deps.fetchText(`https://sponsor.ajay.app/api/skipSegments?videoID=${encodeURIComponent(videoId)}&categories=${categories}`);
    if (!res || (res.status !== 200 && res.status !== 404)) return hit?.skips ?? [];
    const parsed = SegmentsSchema.safeParse(res.status === 200 ? json(res.body) : []);
    const skips = parsed.success ? merged(parsed.data.flatMap(s => (s.actionType === "skip" && isSkipCategory(s.category) && s.segment[1] > s.segment[0] ? [{ start: s.segment[0], end: s.segment[1], category: s.category }] : []))) : [];
    cache.set(videoId, { at: now(), skips });
    return skips;
  };
}
