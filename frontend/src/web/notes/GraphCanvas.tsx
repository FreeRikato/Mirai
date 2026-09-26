import { cn } from "cn";
import { useEffect, useRef, useState, type PointerEvent, type WheelEvent } from "react";
import type { Graph, Layout, Point } from "./graph";
import { toScreen as project, zoomAt, type Camera, type Size } from "./camera";

export type Emphasis = {
  lit: ReadonlySet<string> | null;
  rings: ReadonlyMap<string, "strong" | "soft">;
  strongEdges: ReadonlySet<string>;
  labels: ReadonlySet<string>;
};

export const edgeKey = (a: string, b: string) => (a < b ? `${a}\n${b}` : `${b}\n${a}`);

const LABEL_ZOOM = 1.4;
const DRAG_SLOP = 4;
const FONT = '10px "Martian Mono", ui-monospace, monospace';

const radius = (degree: number, k: number) => (3 + Math.sqrt(degree) * 1.6) * Math.min(1.6, Math.max(0.6, Math.sqrt(k)));

export type GraphCanvasProps = {
  graph: Graph;
  layout: Layout;
  colors: ReadonlyMap<string, string>;
  camera: Camera;
  onCamera: (camera: Camera) => void;
  emphasis: Emphasis;
  onHover: (id: string | null) => void;
  onOpen: (id: string) => void;
  onPin?: (id: string) => void;
  onSize?: (size: Size) => void;
  label: string;
  className?: string;
};

export function GraphCanvas({ graph, layout, colors, camera, onCamera, emphasis, onHover, onOpen, onPin, onSize, label, className }: GraphCanvasProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<Size>({ w: 0, h: 0 });
  const drag = useRef<{ x: number; y: number; cam: Camera; hit: string | null; moved: boolean } | null>(null);
  const sizeHandler = useRef(onSize);
  sizeHandler.current = onSize;

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const next = { w: entry.contentRect.width, h: entry.contentRect.height };
      setSize(next);
      sizeHandler.current?.(next);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const toScreen = (p: Point): Point => project(camera, size, p);

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx || size.w === 0) return;
    const dpr = window.devicePixelRatio || 1;
    el.width = Math.round(size.w * dpr);
    el.height = Math.round(size.h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);
    const { lit, rings, strongEdges, labels } = emphasis;
    const isLit = (id: string) => lit === null || lit.has(id);
    const screen = new Map<string, Point>();
    for (const n of graph.nodes) {
      const p = layout.get(n.id);
      if (p) screen.set(n.id, toScreen(p));
    }

    const strokeEdges = (style: string, width: number, pick: (a: string, b: string) => boolean) => {
      ctx.beginPath();
      for (const [a, b] of graph.edges) {
        const pa = screen.get(a);
        const pb = screen.get(b);
        if (!pa || !pb || !pick(a, b)) continue;
        ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(pb.x, pb.y);
      }
      ctx.strokeStyle = style;
      ctx.lineWidth = width;
      ctx.stroke();
    };
    strokeEdges("rgba(255,255,255,0.04)", 1, (a, b) => !strongEdges.has(edgeKey(a, b)) && !(isLit(a) && isLit(b)));
    strokeEdges("rgba(255,255,255,0.16)", 1, (a, b) => !strongEdges.has(edgeKey(a, b)) && isLit(a) && isLit(b));
    strokeEdges("rgba(255,255,255,0.6)", 1.3, (a, b) => strongEdges.has(edgeKey(a, b)));

    const hubDegree = graph.nodes.map(n => n.degree).toSorted((a, b) => b - a)[Math.floor(graph.nodes.length * 0.08)] ?? Infinity;
    ctx.font = FONT;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (const n of graph.nodes) {
      const p = screen.get(n.id);
      if (!p || p.x < -40 || p.y < -40 || p.x > size.w + 40 || p.y > size.h + 40) continue;
      const r = radius(n.degree, camera.k);
      const on = isLit(n.id);
      const ring = rings.get(n.id);
      ctx.globalAlpha = on ? 1 : 0.16;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = colors.get(n.folder) ?? "#cfcfcf";
      ctx.fill();
      if (ring) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, r + 3, 0, Math.PI * 2);
        ctx.strokeStyle = ring === "strong" ? "#ffffff" : "rgba(255,255,255,0.35)";
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      const showLabel = ring !== undefined || labels.has(n.id) || camera.k >= LABEL_ZOOM || (n.degree >= Math.max(hubDegree, 2) && on);
      if (showLabel) {
        ctx.fillStyle = ring === "strong" ? "#ffffff" : "#bfbfbf";
        ctx.fillText(n.title, p.x, p.y + r + 5);
      }
    }
    ctx.globalAlpha = 1;
  });

  const nodeAt = (x: number, y: number): string | null => {
    let best: string | null = null;
    let bestD = Infinity;
    for (const n of graph.nodes) {
      const p = layout.get(n.id);
      if (!p) continue;
      const s = toScreen(p);
      const d = Math.hypot(s.x - x, s.y - y);
      if (d <= Math.max(radius(n.degree, camera.k) + 4, 8) && d < bestD) {
        best = n.id;
        bestD = d;
      }
    }
    return best;
  };

  const local = (e: PointerEvent | WheelEvent): Point => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  return (
    <canvas
      ref={canvas}
      role="img"
      aria-label={label}
      className={cn("block size-full touch-none", className)}
      onPointerDown={e => {
        const at = local(e);
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { ...at, cam: camera, hit: nodeAt(at.x, at.y), moved: false };
      }}
      onPointerMove={e => {
        const at = local(e);
        const d = drag.current;
        if (d) {
          if (!d.moved && Math.hypot(at.x - d.x, at.y - d.y) < DRAG_SLOP) return;
          d.moved = true;
          onHover(null);
          onCamera({ ...d.cam, x: d.cam.x - (at.x - d.x) / d.cam.k, y: d.cam.y - (at.y - d.y) / d.cam.k });
          return;
        }
        const id = nodeAt(at.x, at.y);
        onHover(id);
        e.currentTarget.style.cursor = id ? "pointer" : "grab";
      }}
      onPointerUp={e => {
        const d = drag.current;
        drag.current = null;
        if (!d || d.moved || !d.hit) return;
        if (e.shiftKey && onPin) onPin(d.hit);
        else onOpen(d.hit);
      }}
      onPointerLeave={() => {
        if (!drag.current) onHover(null);
      }}
      onWheel={e => onCamera(zoomAt(camera, size, Math.exp(-e.deltaY * 0.0015), local(e)))}
    />
  );
}
