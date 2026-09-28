import { describe, expect, test } from "bun:test";
import type { NoteMeta } from "@/shared/notes";
import { buildGraph, backlinksOf, folderColors, layoutGraph, neighborhood } from "./graph";

const note = (id: string, links: string[] = [], folder = ""): NoteMeta => ({ id, title: id, folder, mtime: 0, words: 0, excerpt: "", links: links.map(to => ({ to, context: `see [[${to}]]` })) });

const notes = [note("a", ["b", "c"]), note("b", ["a"]), note("c", ["d"], "x"), note("d", [], "x"), note("lonely")];

describe("buildGraph", () => {
  test("merges links in both directions into one undirected edge and counts degree", () => {
    const g = buildGraph(notes);
    expect(g.edges).toEqual([
      ["a", "b"],
      ["a", "c"],
      ["c", "d"],
    ]);
    expect(Object.fromEntries(g.nodes.map(n => [n.id, n.degree]))).toEqual({ a: 2, b: 1, c: 2, d: 1, lonely: 0 });
  });
});

describe("neighborhood", () => {
  test("walks links in both directions up to the given depth", () => {
    const g = buildGraph(notes);
    expect([...neighborhood(g, "d", 1)].toSorted()).toEqual(["c", "d"]);
    expect([...neighborhood(g, "d", 2)].toSorted()).toEqual(["a", "c", "d"]);
  });
});

describe("backlinksOf", () => {
  test("lists notes that link here with the line they link from", () => {
    expect(backlinksOf(notes, "a")).toEqual([{ id: "b", context: "see [[a]]" }]);
  });
});

describe("folderColors", () => {
  test("gives the biggest folders the first palette colors and root notes a neutral tone", () => {
    const c = folderColors([note("1", [], "x"), note("2", [], "x"), note("3", [], "y"), note("4")]);
    expect(c.get("x")).not.toBe(c.get("y"));
    expect(c.get("")).toBe("var(--color-soft)");
  });
});

describe("layoutGraph", () => {
  const g = buildGraph(notes);
  const dist = (p: Map<string, { x: number; y: number }>, a: string, b: string) => {
    const pa = p.get(a);
    const pb = p.get(b);
    return pa && pb ? Math.hypot(pa.x - pb.x, pa.y - pb.y) : NaN;
  };

  test("is deterministic and pulls linked notes closer than unlinked ones", () => {
    const one = layoutGraph(g);
    expect(layoutGraph(g)).toEqual(one);
    expect(dist(one, "a", "b")).toBeLessThan(dist(one, "b", "d"));
    expect([...one.values()].every(p => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
  });

  test("keeps existing notes near where they were when the vault changes", () => {
    const before = layoutGraph(g);
    const after = layoutGraph(buildGraph([...notes, note("new", ["a"])]), before);
    const moved = (id: string) => Math.hypot((after.get(id)?.x ?? NaN) - (before.get(id)?.x ?? NaN), (after.get(id)?.y ?? NaN) - (before.get(id)?.y ?? NaN));
    const link = dist(before, "a", "b");
    expect(["a", "b", "c", "d"].every(id => moved(id) < link / 2)).toBe(true);
    expect(dist(after, "new", "a")).toBeLessThan(dist(after, "new", "d"));
  });
});
