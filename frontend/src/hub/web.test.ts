import { expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWebApp } from "./web";

const get = (app: (req: Request) => Promise<Response>, path: string) => app(new Request(`http://hub${path}`));

async function built() {
  const dir = await mkdtemp(join(tmpdir(), "mirai-dist-"));
  await writeFile(join(dir, "index.html"), "<html>shell</html>");
  await writeFile(join(dir, "index-8ybq7w2k.js"), "console.log(1)");
  return createWebApp(dir);
}

test("hashed build files are cached for good, while the page itself is always revalidated", async () => {
  const app = await built();
  const js = await get(app, "/index-8ybq7w2k.js");
  expect(await js.text()).toBe("console.log(1)");
  expect(js.headers.get("cache-control")).toContain("immutable");
  expect((await get(app, "/")).headers.get("cache-control")).toBe("no-cache");
});

test("app routes get the page so the client router can take over, but a missing file is a 404 rather than html posing as script", async () => {
  const app = await built();
  expect(await (await get(app, "/ship/mine/PR_1")).text()).toBe("<html>shell</html>");
  expect((await get(app, "/missing-8ybq7w2k.js")).status).toBe(404);
});

test("paths that climb out of the build folder never read the files next to it", async () => {
  const outside = await mkdtemp(join(tmpdir(), "mirai-outside-"));
  await mkdir(join(outside, "dist"));
  await writeFile(join(outside, "dist", "index.html"), "<html>shell</html>");
  await writeFile(join(outside, "secret.json"), "hub.env contents");
  const app = await createWebApp(join(outside, "dist"));
  for (const path of ["/../secret.json", "/%2e%2e/secret.json", "/..%2fsecret.json", "/%2e%2e%2fsecret.json"]) expect(await (await get(app, path)).text()).not.toContain("hub.env");
});

test("a hub started without a build refuses to run instead of serving nothing", async () => {
  await expect(createWebApp(await mkdtemp(join(tmpdir(), "mirai-empty-")))).rejects.toThrow("bun run build");
});

test("a build file is sent precompressed in the best encoding the browser accepts, keeping its real content type", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mirai-dist-"));
  await writeFile(join(dir, "index.html"), "<html>shell</html>");
  await writeFile(join(dir, "chunk-8ybq7w2k.js"), "raw");
  await writeFile(join(dir, "chunk-8ybq7w2k.js.br"), "brotli");
  await writeFile(join(dir, "chunk-8ybq7w2k.js.gz"), "gzip");
  const app = await createWebApp(dir);
  const fetchWith = (encoding: string | null) => app(new Request("http://hub/chunk-8ybq7w2k.js", { headers: encoding ? { "accept-encoding": encoding } : {} }));
  const br = await fetchWith("gzip, deflate, br, zstd");
  expect(await br.text()).toBe("brotli");
  expect(br.headers.get("content-encoding")).toBe("br");
  expect(br.headers.get("content-type")).toContain("javascript");
  expect(br.headers.get("vary")).toBe("accept-encoding");
  expect(br.headers.get("cache-control")).toContain("immutable");
  const gz = await fetchWith("gzip");
  expect([await gz.text(), gz.headers.get("content-encoding")]).toEqual(["gzip", "gzip"]);
  const plain = await fetchWith(null);
  expect([await plain.text(), plain.headers.get("content-encoding")]).toEqual(["raw", null]);
});

test("a file with no precompressed copy is sent as is", async () => {
  const app = await built();
  const js = await app(new Request("http://hub/index-8ybq7w2k.js", { headers: { "accept-encoding": "br, gzip" } }));
  expect([await js.text(), js.headers.get("content-encoding")]).toEqual(["console.log(1)", null]);
});
