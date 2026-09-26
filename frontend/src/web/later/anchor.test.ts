import { describe, expect, test } from "bun:test";
import { anchorAt, findAll, locate } from "./anchor";

const TEXT = "Jev is a classifier. Some say Jev is hype. I think Jev is a classifier with good ergonomics.";

describe("anchorAt", () => {
  test("keeps the selected text with a little of what comes before and after", () => {
    const start = TEXT.lastIndexOf("Jev is a classifier");
    expect(anchorAt(TEXT, start, start + 19, 8)).toEqual({ quote: "Jev is a classifier", prefix: "I think ", suffix: " with go" });
  });
});

describe("locate", () => {
  test("finds the occurrence whose surroundings match, not just the first one", () => {
    const start = TEXT.lastIndexOf("Jev is a classifier");
    const anchor = anchorAt(TEXT, start, start + 19, 12);
    expect(locate(TEXT, anchor)).toEqual({ start, end: start + 19 });
  });

  test("still finds the quote after the text around it changed, and gives up when the quote is gone", () => {
    const anchor = { quote: "good ergonomics", prefix: "with ", suffix: "." };
    const edited = `New comment on top. ${TEXT}`;
    const at = edited.indexOf("good ergonomics");
    expect(locate(edited, anchor)).toEqual({ start: at, end: at + 15 });
    expect(locate("nothing here", anchor)).toBeNull();
  });
});

describe("findAll", () => {
  test("matches case-insensitively and ignores queries shorter than two characters", () => {
    expect(findAll(TEXT, "jev")).toEqual([
      [0, 3],
      [30, 33],
      [51, 54],
    ]);
    expect(findAll(TEXT, "j")).toEqual([]);
    expect(findAll(TEXT, "  ")).toEqual([]);
  });
});
