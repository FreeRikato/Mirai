import type { Segment } from "@/shared/later";

export type Caption = { start: number; end: number; text: string };

const MAX_CHARS = 84;

function wrap(sentence: string): string[] {
  if (sentence.length <= MAX_CHARS) return [sentence];
  const target = sentence.length / Math.ceil(sentence.length / MAX_CHARS);
  const pieces: string[] = [];
  let line = "";
  for (const word of sentence.split(" ")) {
    line = line ? `${line} ${word}` : word;
    if (line.length >= target) {
      pieces.push(line);
      line = "";
    }
  }
  if (line) pieces.push(line);
  return pieces;
}

function split(segment: Segment): Caption[] {
  const pieces = segment.text.split(/(?<=[.?!])\s+/).flatMap(wrap);
  const chars = pieces.reduce((n, p) => n + p.length, 0);
  const perChar = (segment.end - segment.start) / Math.max(1, chars);
  let at = segment.start;
  return pieces.map(text => {
    const start = at;
    at += text.length * perChar;
    return { start, end: at, text };
  });
}

export const toCaptions = (segments: readonly Segment[]): Caption[] => segments.flatMap(split);

export function captionAt(captions: readonly Caption[], time: number): string | null {
  let lo = 0;
  let hi = captions.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((captions[mid]?.start ?? Infinity) <= time) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  const c = captions[found];
  return c && time < c.end ? c.text : null;
}
