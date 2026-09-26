import { dirname, resolve, sep } from "node:path";

export function vendorFile(dir: string, rel: string): string | null {
  if (!rel.endsWith(".mjs")) return null;
  const path = resolve(dir, rel);
  return path.startsWith(dir + sep) ? path : null;
}

const PACKAGES = ["mermaid", "hls.js"] as const;

function packageRoute(pkg: string) {
  const dir = dirname(Bun.resolveSync(pkg, import.meta.dir));
  const prefix = `/vendor/${pkg}/`;
  return async (req: Request) => {
    const path = vendorFile(dir, decodeURIComponent(new URL(req.url).pathname.slice(prefix.length)));
    const file = path ? Bun.file(path) : null;
    if (!file || !(await file.exists())) return new Response("not found", { status: 404 });
    return new Response(file, { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "public, max-age=86400" } });
  };
}

export const createVendorRoutes = () => Object.fromEntries(PACKAGES.map(pkg => [`/vendor/${pkg}/*`, packageRoute(pkg)]));
