import { expect, test } from "bun:test";
import { compressJson } from "./compress";

const big = { rows: Array.from({ length: 200 }, (_, i) => ({ id: i, title: `pull request number ${i}` })) };
const ask = (encoding: string | null) => new Request("http://hub/api/ship", { headers: encoding ? { "accept-encoding": encoding } : {} });

const routes = compressJson({
  "/api/ship": (_req: Request) => Response.json(big),
  "/api/tiny": { GET: async (_req: Request) => Response.json({ ok: true }) },
  "/api/text": (_req: Request) => new Response("x".repeat(4096)),
});

test("a large JSON reply is gzipped for a browser that accepts gzip and decodes back to the same data", async () => {
  const res = await routes["/api/ship"](ask("gzip, deflate, br"));
  expect(res.headers.get("content-encoding")).toBe("gzip");
  expect(res.headers.get("vary")).toContain("accept-encoding");
  const zipped = new Uint8Array(await res.arrayBuffer());
  expect(zipped.byteLength).toBeLessThan(JSON.stringify(big).length / 4);
  expect(JSON.parse(new TextDecoder().decode(Bun.gunzipSync(zipped)))).toEqual(big);
});

test("small replies, clients without gzip, and non-JSON replies are sent as they were", async () => {
  const tiny = await routes["/api/tiny"].GET(ask("gzip"));
  expect([tiny.headers.get("content-encoding"), await tiny.json()]).toEqual([null, { ok: true }]);
  const plain = await routes["/api/ship"](ask(null));
  expect([plain.headers.get("content-encoding"), await plain.json()]).toEqual([null, big]);
  const text = await routes["/api/text"](ask("gzip"));
  expect([text.headers.get("content-encoding"), (await text.text()).length]).toEqual([null, 4096]);
});
