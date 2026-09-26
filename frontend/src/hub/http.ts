import { z } from "zod";
import { RemoteError } from "./remote";

export async function readWrite<S extends z.ZodType>(req: Request, schema: S, expected: string): Promise<{ ok: true; body: z.infer<S> } | { ok: false; res: Response }> {
  const origin = req.headers.get("origin");
  if ((origin !== null && URL.parse(origin)?.host !== new URL(req.url).host) || !req.headers.get("content-type")?.startsWith("application/json")) {
    return { ok: false, res: Response.json({ error: "writes need a same-origin JSON request" }, { status: 403 }) };
  }
  const parsed = schema.safeParse(await req.json().catch(() => null));
  return parsed.success ? { ok: true, body: parsed.data } : { ok: false, res: Response.json({ error: `expected ${expected}` }, { status: 400 }) };
}

export async function remoteWrite(run: () => Promise<{ ok: true } | { ok: false; error: string }>): Promise<Response> {
  try {
    const out = await run();
    return out.ok ? Response.json(out) : Response.json({ error: out.error }, { status: 422 });
  } catch (err: unknown) {
    if (err instanceof RemoteError || err instanceof z.ZodError) return Response.json({ error: err.message }, { status: 502 });
    throw err;
  }
}
