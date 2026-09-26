import { describe, expect, test } from "bun:test";
import { createAssetResolver, createResolver, findWikiLinks, imageEmbeds, isNoteTarget, noteTargets, unwrapWikiLinks, wikiLabel } from "./wikilinks";

describe("findWikiLinks", () => {
  test("reads target, heading, alias and embed with their offsets", () => {
    const text = "see [[aws-iam]] and [[Postgres internals#Rewriter|the rewriter]] or ![[diagram.png]]";
    const links = findWikiLinks(text);
    expect(links.map(l => [l.target, l.heading, l.alias, l.embed])).toEqual([
      ["aws-iam", null, null, false],
      ["Postgres internals", "Rewriter", "the rewriter", false],
      ["diagram.png", null, null, true],
    ]);
    expect(links.map(l => text.slice(l.from, l.to))).toEqual(["[[aws-iam]]", "[[Postgres internals#Rewriter|the rewriter]]", "![[diagram.png]]"]);
  });

  test("ignores links inside fenced and inline code", () => {
    const text = ["[[real]]", "```", "[[fenced]]", "```", "`[[inline]]` and [[after]]"].join("\n");
    expect(findWikiLinks(text).map(l => l.target)).toEqual(["real", "after"]);
  });

  test("accepts the table-escaped alias pipe", () => {
    expect(findWikiLinks("| [[aws-s3\\|S3]] |").map(l => [l.target, l.alias])).toEqual([["aws-s3", "S3"]]);
  });
});

describe("wikiLabel", () => {
  test("prefers the alias, then target with heading", () => {
    const [a, b] = findWikiLinks("[[x|shown]] [[y#h]]");
    expect(a && wikiLabel(a)).toBe("shown");
    expect(b && wikiLabel(b)).toBe("y > h");
  });
});

describe("isNoteTarget", () => {
  test("treats extensionless and .md targets as notes, everything else as attachments", () => {
    expect([isNoteTarget("aws-iam"), isNoteTarget("a/b.md"), isNoteTarget("v1.2 notes"), isNoteTarget("diagram.png"), isNoteTarget("")]).toEqual([true, true, true, false, false]);
  });
});

describe("createResolver", () => {
  const resolve = createResolver(["Daily/2026-09-24", "aws/aws-iam", "archive/aws/aws-iam", "Databrain", "Store/Readme"]);

  test("matches a basename case-insensitively, preferring the shortest path", () => {
    expect(resolve("AWS-IAM")).toBe("aws/aws-iam");
    expect(resolve("databrain.md")).toBe("Databrain");
  });

  test("matches a path suffix when the link names folders", () => {
    expect(resolve("archive/aws/aws-iam")).toBe("archive/aws/aws-iam");
    expect(resolve("store/readme")).toBe("Store/Readme");
  });

  test("returns null for unknown notes and attachments", () => {
    expect(resolve("nope")).toBeNull();
    expect(resolve("diagram.png")).toBeNull();
  });
});

describe("image embeds", () => {
  test("only embeds of image files count, and the text keeps everything else", () => {
    expect(imageEmbeds("Look at duckdb TLS issue ![[Pasted image 20260924151137.png]] and ![[notes/plan]] ![[shot.JPEG|300]]")).toEqual({
      text: "Look at duckdb TLS issue and ![[notes/plan]]",
      images: ["Pasted image 20260924151137.png", "shot.JPEG"],
    });
    expect(imageEmbeds("no images [[a.png]]")).toEqual({ text: "no images [[a.png]]", images: [] });
  });

  test("an image target resolves to the shortest vault path with that name, or the one matching its folder", () => {
    const resolve = createAssetResolver(["attachments/Pasted image 1.png", "deep/nested/folder/Pasted image 1.png", "a/logo.svg", "b/logo.svg", "notes/plan.md"]);
    expect(resolve("Pasted image 1.png")).toBe("attachments/Pasted image 1.png");
    expect(resolve("pasted IMAGE 1.PNG")).toBe("attachments/Pasted image 1.png");
    expect(resolve("b/logo.svg")).toBe("b/logo.svg");
    expect(resolve("notes/plan.md")).toBeNull();
    expect(resolve("missing.png")).toBeNull();
  });
});

describe("note links in task text", () => {
  test("unwraps note links to their labels and leaves embeds and attachments alone", () => {
    expect(unwrapWikiLinks("[[Verify merged Copilot AI fixes]]")).toBe("Verify merged Copilot AI fixes");
    expect(unwrapWikiLinks("read [[plan#Risks]] and [[a/b|the b note]] ![[shot.png]] [[deck.pdf]]")).toBe("read plan > Risks and the b note ![[shot.png]] [[deck.pdf]]");
  });

  test("lists each linked note target once, in order, skipping embeds and attachments", () => {
    expect(noteTargets("[[Plan]] then [[b#h]] [[plan|again]] ![[Plan]] [[x.pdf]]\n  - see [[b]]")).toEqual(["Plan", "b"]);
  });
});
