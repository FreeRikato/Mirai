const MIN_BYTES = 1024;

export async function gzipJson(req: Request, res: Response): Promise<Response> {
  if (!res.headers.get("content-type")?.startsWith("application/json") || res.headers.has("content-encoding")) return res;
  const headers = new Headers(res.headers);
  headers.append("vary", "accept-encoding");
  const accepts = (req.headers.get("accept-encoding") ?? "").split(",").some(part => part.split(";")[0]?.trim() === "gzip");
  const body = new Uint8Array(await res.arrayBuffer());
  if (!accepts || body.byteLength < MIN_BYTES) return new Response(body, { status: res.status, statusText: res.statusText, headers });
  headers.set("content-encoding", "gzip");
  headers.delete("content-length");
  return new Response(Bun.gzipSync(body), { status: res.status, statusText: res.statusText, headers });
}

const compressing =
  (handler: Function) =>
  async (req: Request, ...rest: unknown[]): Promise<unknown> => {
    const res: unknown = await Reflect.apply(handler, undefined, [req, ...rest]);
    return res instanceof Response ? gzipJson(req, res) : res;
  };

const compressRoute = (value: unknown): unknown => {
  if (typeof value === "function") return compressing(value);
  if (value === null || typeof value !== "object" || value instanceof Response) return value;
  return Object.fromEntries(Object.entries(value).map(([method, handler]) => [method, typeof handler === "function" ? compressing(handler) : handler]));
};

export function compressJson<R extends Record<string, unknown>>(routes: R): R {
  return Object.fromEntries(Object.entries(routes).map(([path, value]) => [path, compressRoute(value)])) as R;
}
