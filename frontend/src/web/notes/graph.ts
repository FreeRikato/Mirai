import type { NoteMeta } from "@/shared/notes";
import { systemThemeValue } from "../systemTheme";
export type GraphNode = { id: string; title: string; folder: string; degree: number };
export type Edge = readonly [string, string];
export type Graph = { nodes: GraphNode[]; edges: Edge[]; adjacent: ReadonlyMap<string, ReadonlySet<string>> };
export type Point = { x: number; y: number };
export type Layout = ReadonlyMap<string, Point>;

export function buildGraph(notes: readonly NoteMeta[]): Graph {
  const ids = new Set(notes.map(n => n.id));
  const keyed = new Map<string, Edge>();
  for (const n of notes) {
    for (const { to } of n.links) {
      if (!ids.has(to) || to === n.id) continue;
      const pair: Edge = n.id < to ? [n.id, to] : [to, n.id];
      keyed.set(pair.join("\n"), pair);
    }
  }
  const edges = [...keyed.entries()].toSorted(([a], [b]) => (a < b ? -1 : 1)).map(([, e]) => e);
  const adjacent = new Map<string, Set<string>>(notes.map(n => [n.id, new Set()]));
  for (const [a, b] of edges) {
    adjacent.get(a)?.add(b);
    adjacent.get(b)?.add(a);
  }
  return { nodes: notes.map(n => ({ id: n.id, title: n.title, folder: n.folder, degree: adjacent.get(n.id)?.size ?? 0 })), edges, adjacent };
}

export function neighborhood(g: Graph, center: string, depth: number): Set<string> {
  const seen = new Set([center]);
  let frontier = [center];
  for (let d = 0; d < depth; d++) {
    frontier = frontier.flatMap(id => [...(g.adjacent.get(id) ?? [])].filter(n => !seen.has(n)));
    for (const id of frontier) seen.add(id);
  }
  return seen;
}

export function subgraph(g: Graph, keep: ReadonlySet<string>): Graph {
  const nodes = g.nodes.filter(n => keep.has(n.id));
  const edges = g.edges.filter(([a, b]) => keep.has(a) && keep.has(b));
  const adjacent = new Map(nodes.map(n => [n.id, new Set([...(g.adjacent.get(n.id) ?? [])].filter(x => keep.has(x)))]));
  return { nodes, edges, adjacent };
}

export const backlinksOf = (notes: readonly NoteMeta[], id: string): { id: string; context: string }[] =>
  notes.flatMap(n => n.links.filter(l => l.to === id).map(l => ({ id: n.id, context: l.context })));

const PALETTE = ["#7fa7ff", "#f4b63f", "#e07bd8", "#4fc8b8", "#a8e06a", "#ff9e7a", "#b69cff", "#6fd3ff", "#f28db2"] as const;
export const ROOT_COLOR = "#cfcfcf";

export function folderColors(notes: readonly NoteMeta[]): Map<string, string> {
  const counts = new Map<string, number>();
  for (const n of notes) if (n.folder) counts.set(n.folder, (counts.get(n.folder) ?? 0) + 1);
  const ranked = [...counts.entries()].toSorted(([a, x], [b, y]) => y - x || a.localeCompare(b));
  return new Map([["", systemThemeValue("--color-soft", ROOT_COLOR)], ...ranked.map(([f], i): [string, string] => [f, PALETTE[i % PALETTE.length] ?? ROOT_COLOR])]);
}

const REPEL = 900;
const LINK_LENGTH = 50;
const SPRING = 0.08;
const GRAVITY = 0.02;
const DECAY = 0.6;
const MAX_STEP = 20;
const GOLDEN_ANGLE = 2.39996;

function offset(id: string, radius: number): Point {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  const angle = ((h >>> 0) / 0xffffffff) * Math.PI * 2;
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
}

function seed(g: Graph, prev: Layout | undefined): { id: string; x: number; y: number; vx: number; vy: number }[] {
  return g.nodes.map((n, i) => {
    const known = prev?.get(n.id);
    const anchor = known ?? [...(g.adjacent.get(n.id) ?? [])].map(x => prev?.get(x)).find(p => p !== undefined);
    const base = anchor ?? { x: 12 * Math.sqrt(i + 0.5) * Math.cos(i * GOLDEN_ANGLE), y: 12 * Math.sqrt(i + 0.5) * Math.sin(i * GOLDEN_ANGLE) };
    const nudge = known ? { x: 0, y: 0 } : offset(n.id, anchor ? LINK_LENGTH : 4);
    return { id: n.id, x: base.x + nudge.x, y: base.y + nudge.y, vx: 0, vy: 0 };
  });
}

const clampStep = (v: number) => Math.max(-MAX_STEP, Math.min(MAX_STEP, v));

export function layoutGraph(g: Graph, prev?: Layout): Map<string, Point> {
  const bodies = seed(g, prev);
  const index = new Map(bodies.map((b, i) => [b.id, i]));
  const links = g.edges.flatMap(([a, b]) => {
    const i = index.get(a);
    const j = index.get(b);
    return i === undefined || j === undefined ? [] : [[i, j] as const];
  });
  const iterations = prev ? 120 : 300;
  const heat = prev ? 0.15 : 1;

  for (let t = 0; t < iterations; t++) {
    const alpha = heat * (1 - t / iterations);
    for (let i = 0; i < bodies.length; i++) {
      const p = bodies[i];
      if (!p) continue;
      for (let j = i + 1; j < bodies.length; j++) {
        const q = bodies[j];
        if (!q) continue;
        const dx = p.x - q.x;
        const dy = p.y - q.y;
        const f = (REPEL * alpha) / Math.max(dx * dx + dy * dy, 1);
        p.vx += dx * f;
        p.vy += dy * f;
        q.vx -= dx * f;
        q.vy -= dy * f;
      }
    }
    for (const [i, j] of links) {
      const p = bodies[i];
      const q = bodies[j];
      if (!p || !q) continue;
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const d = Math.max(Math.hypot(dx, dy), 0.01);
      const f = ((d - LINK_LENGTH) * SPRING * alpha) / d;
      p.vx += dx * f;
      p.vy += dy * f;
      q.vx -= dx * f;
      q.vy -= dy * f;
    }
    for (const b of bodies) {
      b.vx = clampStep((b.vx - b.x * GRAVITY * alpha) * DECAY);
      b.vy = clampStep((b.vy - b.y * GRAVITY * alpha) * DECAY);
      b.x += b.vx;
      b.y += b.vy;
    }
  }
  return new Map(bodies.map(b => [b.id, { x: b.x, y: b.y }]));
}
