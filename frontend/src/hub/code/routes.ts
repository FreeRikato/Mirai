import type { BunRequest, Server } from "bun";
import { Px0OpenSchema, Px0StopSchema, type Px0Sessions } from "@/shared/px0";
import { HighlightQuerySchema, type Highlight, type HighlightQuery, type TokenLine } from "@/shared/code";
import type { Config } from "../config";
import { createCheckouts, GitError } from "./checkouts";
import { createHighlight } from "./highlight";
import { readWrite } from "../http";
import { createPx0, Px0Error } from "../px0/sessions";

const IMMUTABLE = { "cache-control": "private, max-age=31536000, immutable" };
const CACHED_FILES = 300;

const reason = (err: unknown) => (err instanceof Error ? err.message : String(err));

function remember<V>(cache: Map<string, V>, key: string, value: V) {
  cache.delete(key);
  cache.set(key, value);
  const oldest = cache.keys().next();
  if (cache.size > CACHED_FILES && !oldest.done) cache.delete(oldest.value);
}

export function createCodeRoutes(deps: { config: Config["code"]; px0: Config["px0"]; org: string | undefined; token: () => Promise<string> }) {
  const { config, org } = deps;
  const checkouts = createCheckouts({ dir: config.dir, gitUrl: config.gitUrl, token: deps.token });
  const highlight = createHighlight({ bin: config.bin, timeoutMs: config.timeoutMs });
  const px0 = createPx0({ ...deps.px0, workspace: checkouts.workspace, env: async () => ({ ...(await checkouts.gitEnv()), GITHUB_TOKEN: await deps.token() }) });
  setInterval(() => px0.reap(), 60_000);
  const files = new Map<string, Promise<TokenLine[]>>();

  const refused = (repo: string): string | null => {
    if (!org) return "set MIRAI_SHIP_ORG on the hub to allow code features";
    return repo.toLowerCase().startsWith(`${org.toLowerCase()}/`) ? null : `only ${org} repositories are allowed`;
  };

  const colour = async ({ repo, head, base, path, side }: HighlightQuery): Promise<Highlight> => {
    const no = refused(repo);
    if (no) return { kind: "unavailable", reason: no };
    try {
      const sha = side === "new" ? head : await checkouts.mergeBase(repo, head, base);
      const key = `${repo}:${sha}:${path}`;
      let lines = files.get(key);
      if (!lines) {
        lines = checkouts.show(repo, sha, path, config.maxBytes).then(text => (text.slice(0, 8000).includes("\0") ? [] : highlight(path, text)));
        remember(files, key, lines);
        lines.catch(() => files.delete(key));
      }
      return { kind: "ready", lines: await lines };
    } catch (err: unknown) {
      return { kind: "unavailable", reason: reason(err) };
    }
  };

  const routes = {
    "/api/px0": {
      GET: async () => Response.json({ idleMs: deps.px0.idleMs, sessions: await px0.list() } satisfies Px0Sessions),
      POST: async (req: BunRequest) => {
        const r = await readWrite(req, Px0OpenSchema, "{ repo, number }");
        if (!r.ok) return r.res;
        const no = refused(r.body.repo);
        if (no) return Response.json({ error: no }, { status: 403 });
        try {
          const s = await px0.open(r.body);
          return Response.json({ path: s.path });
        } catch (err: unknown) {
          if (err instanceof Px0Error || err instanceof GitError) return Response.json({ error: err.message }, { status: 502 });
          throw err;
        }
      },
    },
    "/api/px0/stop": {
      POST: async (req: BunRequest) => {
        const r = await readWrite(req, Px0StopSchema, "{ id }");
        if (!r.ok) return r.res;
        return px0.stop(r.body.id) ? Response.json({ ok: true }) : Response.json({ error: "no such px0 session" }, { status: 404 });
      },
    },
    "/px0/*": (req: BunRequest, server: Server<unknown>) => px0.proxy(req, server),
    "/api/code/highlight": async (req: BunRequest) => {
      const q = HighlightQuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
      if (!q.success) return Response.json({ error: q.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ") }, { status: 400 });
      const out = await colour(q.data);
      return Response.json(out, { headers: out.kind === "ready" ? IMMUTABLE : {} });
    },
  };

  return { routes, shutdown: px0.shutdown };
}
