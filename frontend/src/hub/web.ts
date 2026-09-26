import { resolve, sep } from "node:path";

const HASHED = /-[a-z0-9]{8}\.[a-z0-9]+$/;
const HAS_EXTENSION = /\/[^/]+\.[a-z0-9]+$/i;

export async function createWebApp(dir: string): Promise<(req: Request) => Promise<Response>> {
  const root = resolve(dir);
  const shell = Bun.file(`${root}/index.html`);
  if (!(await shell.exists())) throw new Error(`no built web app in ${root}; run \`bun run build\` first`);
  const page = () => new Response(shell, { headers: { "cache-control": "no-cache", "content-type": "text/html;charset=utf-8" } });
  return async req => {
    const path = decodeURIComponent(new URL(req.url).pathname);
    const target = resolve(root, `.${path}`);
    if (path === "/" || !target.startsWith(`${root}${sep}`)) return page();
    const file = Bun.file(target);
    if (!(await file.exists())) return HAS_EXTENSION.test(path) ? new Response("not found", { status: 404 }) : page();
    const headers: Record<string, string> = { "cache-control": HASHED.test(target) ? "public, max-age=31536000, immutable" : "no-cache", "content-type": file.type, vary: "accept-encoding" };
    const encoded = await precompressed(target, req.headers.get("accept-encoding") ?? "");
    if (!encoded) return new Response(file, { headers });
    return new Response(encoded.file, { headers: { ...headers, "content-encoding": encoded.encoding } });
  };
}

const ENCODINGS = [
  { encoding: "br", suffix: ".br" },
  { encoding: "gzip", suffix: ".gz" },
] as const;

async function precompressed(target: string, accepted: string) {
  const offered = new Set(accepted.split(",").map(part => part.split(";")[0]?.trim()));
  for (const { encoding, suffix } of ENCODINGS) {
    if (!offered.has(encoding)) continue;
    const file = Bun.file(`${target}${suffix}`);
    if (await file.exists()) return { encoding, file };
  }
  return null;
}
