import { describe, expect, test } from "bun:test";
import { fitCamera, toScreen, zoomAt } from "./camera";

const size = { w: 800, h: 600 };

describe("zoomAt", () => {
  test("keeps the point under the cursor fixed and clamps the zoom", () => {
    const cam = { x: 10, y: -20, k: 1 };
    const cursor = { x: 620, y: 150 };
    const world = { x: cam.x + (cursor.x - 400) / cam.k, y: cam.y + (cursor.y - 300) / cam.k };
    const next = zoomAt(cam, size, 2.5, cursor);
    const back = toScreen(next, size, world);
    expect([Math.round(back.x), Math.round(back.y), next.k]).toEqual([620, 150, 2.5]);
    expect(zoomAt(cam, size, 1000).k).toBe(4);
  });
});

describe("fitCamera", () => {
  test("centers the chosen notes and zooms so they fit inside the padding", () => {
    const layout = new Map([["a", { x: -100, y: 0 }], ["b", { x: 300, y: 100 }], ["far", { x: 5000, y: 5000 }]]);
    const cam = fitCamera(layout, ["a", "b"], size);
    expect([cam.x, cam.y]).toEqual([100, 50]);
    expect(toScreen(cam, size, { x: -100, y: 0 }).x).toBeGreaterThanOrEqual(60);
    expect(toScreen(cam, size, { x: 300, y: 100 }).x).toBeLessThanOrEqual(740);
  });
});
