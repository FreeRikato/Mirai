import { expect, test } from "@playwright/test";

test("the page links an installable manifest whose icons and service worker are all served", async ({ page, request }) => {
  await page.goto("/machines");
  const href = await page.locator('link[rel="manifest"]').getAttribute("href");
  expect(href).toBeTruthy();

  const manifest = await request.get(new URL(href ?? "", page.url()).href);
  expect(manifest.status()).toBe(200);
  const body: { display: string; start_url: string; icons: { src: string; purpose: string }[] } = await manifest.json();
  expect(body.display).toBe("standalone");
  expect(body.icons.some(i => i.purpose === "maskable")).toBe(true);
  for (const icon of body.icons) expect((await request.get(icon.src)).status(), icon.src).toBe(200);

  const sw = await request.get("/sw.js");
  expect(sw.status()).toBe(200);
  expect(sw.headers()["cache-control"]).toBe("no-cache");
  expect(sw.headers()["content-type"]).toContain("javascript");
});
