import { describe, expect, test } from "bun:test";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { previewDecorations } from "./livePreview";

function render(doc: string, activeLines: number[] = []) {
  const state = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] });
  ensureSyntaxTree(state, doc.length, 5000);
  const set = previewDecorations(state, new Set(activeLines), { exists: t => t !== "missing" });
  const hidden: string[] = [];
  const marks: [string, string][] = [];
  const lines: string[] = [];
  const widgets: string[] = [];
  set.between(0, doc.length, (from, to, deco) => {
    const spec: { class?: string; widget?: { constructor: { name: string } } } = deco.spec;
    if (deco.point && spec.widget) widgets.push(`${spec.widget.constructor.name}:${doc.slice(from, to)}`);
    else if (deco.point && from < to) hidden.push(doc.slice(from, to));
    else if (from === to && spec.class) lines.push(spec.class);
    else if (spec.class) marks.push([spec.class, doc.slice(from, to)]);
  });
  return { hidden, marks, lines, widgets };
}

describe("previewDecorations", () => {
  test("renders headings, emphasis and code by hiding their syntax off the cursor line", () => {
    const r = render("## Title\n**bold** and `code`");
    expect(r.hidden).toEqual(["## ", "**", "**", "`", "`"]);
    expect(r.lines).toContain("cm-md-h2");
    expect(r.marks).toContainEqual(["cm-md-strong", "**bold**"]);
    expect(r.marks).toContainEqual(["cm-md-code", "`code`"]);
  });

  test("shows raw syntax on the line being edited but keeps the styling", () => {
    const r = render("## Title\n**bold**", [2]);
    expect(r.hidden).toEqual(["## "]);
    expect(r.marks).toContainEqual(["cm-md-strong", "**bold**"]);
  });

  test("renders wiki-links as their label and flags ones with no note", () => {
    const r = render("see [[aws-iam|IAM]] and [[missing]]");
    expect(r.hidden).toEqual(["[[aws-iam|", "]]", "[[", "]]"]);
    expect(r.marks).toEqual([
      ["cm-md-wikilink", "IAM"],
      ["cm-md-wikilink cm-md-wikilink-missing", "missing"],
    ]);
  });

  test("keeps wiki-link brackets visible while the cursor is on them", () => {
    const r = render("see [[aws-iam]]", [1]);
    expect(r.hidden).toEqual([]);
    expect(r.marks).toEqual([
      ["cm-md-bracket", "[["],
      ["cm-md-wikilink", "aws-iam"],
      ["cm-md-bracket", "]]"],
    ]);
  });

  test("turns task markers, bullets and markdown links into rendered pieces", () => {
    const r = render("- [x] shipped\n- plain\n[docs](https://x.dev)");
    expect(r.widgets).toEqual(["TaskWidget:- [x] ", "BulletWidget:-"]);
    expect(r.lines).toContain("cm-md-task-closed");
    expect(r.hidden).toEqual(["[", "](https://x.dev)"]);
    expect(r.marks).toContainEqual(["cm-md-link", "docs"]);
  });

  test("leaves wiki-link syntax inside code alone", () => {
    expect(render("`[[not a link]]`").marks).toEqual([["cm-md-code", "`[[not a link]]`"]]);
  });
});
