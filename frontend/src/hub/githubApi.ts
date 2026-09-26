import { graphql, RemoteError } from "./remote";

type GithubConfig = { token: string | undefined; url: string; timeoutMs: number };

export async function resolveToken(configured: string | undefined): Promise<string | null> {
  if (configured) return configured;
  const out = await Bun.$`gh auth token`.quiet().nothrow();
  const token = out.stdout.toString().trim();
  return out.exitCode === 0 && token ? token : null;
}

function tokenSource(configured: string | undefined) {
  let token: Promise<string | null> | null = null;
  return async (): Promise<string> => {
    token ??= resolveToken(configured);
    const t = await token;
    if (t) return t;
    token = null;
    throw new RemoteError("set GITHUB_TOKEN on the hub, or log the hub machine into the gh CLI");
  };
}

type Saved = { etag: string; body: unknown };

const SAVED_LIMIT = 500;

function remember(saved: Map<string, Saved>, path: string, entry: Saved) {
  saved.delete(path);
  saved.set(path, entry);
  const oldest = saved.keys().next();
  if (saved.size > SAVED_LIMIT && !oldest.done) saved.delete(oldest.value);
}

function limitResetMs(res: Response): number | null {
  if (res.status !== 403 && res.status !== 429) return null;
  const retryAfter = Number(res.headers.get("retry-after"));
  if (retryAfter > 0) return Date.now() + retryAfter * 1000;
  if (res.headers.get("x-ratelimit-remaining") !== "0") return null;
  const reset = Number(res.headers.get("x-ratelimit-reset"));
  return reset > 0 ? reset * 1000 : Date.now() + 60_000;
}

const clock = (ms: number): string => new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

export const restBase =(graphqlUrl: string): string => graphqlUrl.replace(/\/api\/graphql$/, "/api/v3").replace(/\/graphql$/, "");

export function createGithubClients({ token: configured, url, timeoutMs }: GithubConfig) {
  const token = tokenSource(configured);
  const base = restBase(url);

  const api = async (query: string, variables: Record<string, unknown> = {}): Promise<unknown> => graphql(url, `bearer ${await token()}`, timeoutMs, query, variables);

  const saved = new Map<string, Saved>();
  let blockedUntil = 0;

  const rateLimited = (path: string): unknown => {
    const last = saved.get(path);
    if (last) return last.body;
    throw new RemoteError(`GitHub rate limit reached, resets at ${clock(blockedUntil)}`);
  };

  const rest = async (path: string): Promise<unknown> => {
    if (Date.now() < blockedUntil) return rateLimited(path);
    const last = saved.get(path);
    const res = await fetch(`${base}${path}`, {
      headers: { accept: "application/vnd.github+json", authorization: `bearer ${await token()}`, ...(last && { "if-none-match": last.etag }) },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status === 304 && last) return last.body;
    const reset = limitResetMs(res);
    if (reset !== null) {
      blockedUntil = reset;
      return rateLimited(path);
    }
    if (!res.ok) throw new RemoteError(`${new URL(base).host} answered ${res.status}`);
    const body: unknown = await res.json();
    const etag = res.headers.get("etag");
    if (etag) remember(saved, path, { etag, body });
    return body;
  };

  return { api, rest, token };
}

export type GithubApi = (query: string, variables?: Record<string, unknown>) => Promise<unknown>;
export type GithubRest = (path: string) => Promise<unknown>;
