import { expect, test } from "bun:test";
import { captionAt, toCaptions } from "./captions";

test("a short line shows from its start to its end, and nothing shows in the pause after it", () => {
  const captions = toCaptions([
    { start: 239.65, end: 241.23, text: "Auto merging PRs for me?" },
    { start: 252.17, end: 252.78, text: "And they were good." },
  ]);
  expect(captionAt(captions, 239)).toBeNull();
  expect(captionAt(captions, 239.65)).toBe("Auto merging PRs for me?");
  expect(captionAt(captions, 241)).toBe("Auto merging PRs for me?");
  expect(captionAt(captions, 245)).toBeNull();
  expect(captionAt(captions, 252.5)).toBe("And they were good.");
  expect(captionAt(captions, 300)).toBeNull();
});

test("a long line is split into sentences, each shown for its share of the line's time", () => {
  const captions = toCaptions([{ start: 100, end: 110, text: "Which is like a wild thing to say. But like, I woke up today and there were like 20 PRs landed." }]);
  expect(captionAt(captions, 101)).toBe("Which is like a wild thing to say.");
  expect(captionAt(captions, 105)).toBe("But like, I woke up today and there were like 20 PRs landed.");
  expect(captionAt(captions, 103.4)).toBe("Which is like a wild thing to say.");
  expect(captionAt(captions, 103.8)).toBe("But like, I woke up today and there were like 20 PRs landed.");
});

test("a long sentence is broken between words so no caption runs past two short lines", () => {
  const text = "Uh I actually have it sounds kind of scary to say this and it it makes me sound like a slop artist, but I promise I'm not";
  const captions = toCaptions([{ start: 0, end: 9, text }]);
  const shown = [...new Set(Array.from({ length: 90 }, (_, i) => captionAt(captions, i / 10)))];
  expect(shown.join(" ")).toBe(text);
  for (const line of shown) expect(line?.length).toBeLessThanOrEqual(84);
  expect(shown.length).toBeGreaterThan(1);
});
