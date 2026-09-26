import type { Layout, Point } from "./graph";

export type Camera = { x: number; y: number; k: number };
export type Size = { w: number; h: number };

const MIN_ZOOM = 0.15;
const MAX_ZOOM = 4;
const FIT_MAX_ZOOM = 1.6;

export const clampZoom = (k: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));

export function fitCamera(layout: Layout, ids: Iterable<string>, size: Size, pad = 60): Camera {
  const pts = [...ids].flatMap(id => layout.get(id) ?? []);
  if (pts.length === 0 || size.w === 0 || size.h === 0) return { x: 0, y: 0, k: 1 };
  const xs = pts.map(p => p.x);
  const ys = pts.map(p => p.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const room = (px: number) => Math.max(px - pad * 2, px / 2);
  const k = clampZoom(Math.min(room(size.w) / Math.max(x1 - x0, 1), room(size.h) / Math.max(y1 - y0, 1), FIT_MAX_ZOOM));
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, k };
}

export const toScreen = (cam: Camera, size: Size, p: Point): Point => ({ x: size.w / 2 + (p.x - cam.x) * cam.k, y: size.h / 2 + (p.y - cam.y) * cam.k });

export function zoomAt(cam: Camera, size: Size, factor: number, at: Point = { x: size.w / 2, y: size.h / 2 }): Camera {
  const k = clampZoom(cam.k * factor);
  const wx = cam.x + (at.x - size.w / 2) / cam.k;
  const wy = cam.y + (at.y - size.h / 2) / cam.k;
  return { x: wx - (at.x - size.w / 2) / k, y: wy - (at.y - size.h / 2) / k, k };
}
