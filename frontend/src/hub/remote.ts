export class RemoteError extends Error {}

export async function graphql(endpoint: string, auth: string, timeoutMs: number, query: string, variables: Record<string, unknown> = {}): Promise<unknown> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: auth },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) throw new RemoteError(`${new URL(endpoint).host} answered ${res.status}`);
  if (typeof body === "object" && body !== null && "errors" in body && Array.isArray(body.errors) && body.errors.length > 0) {
    const first: unknown = body.errors[0];
    const message = typeof first === "object" && first !== null && "message" in first ? String(first.message) : "unknown error";
    throw new RemoteError(message);
  }
  return typeof body === "object" && body !== null && "data" in body ? body.data : null;
}

export type Cached<T> = { value: T; at: number };

export function cached<T>(load: () => Promise<T>, ttlMs: number) {
  let good: Cached<T> | null = null;
  let inflight: Promise<Cached<T>> | null = null;
  let failedAt = 0;
  let generation = 0;

  const refresh = (): Promise<Cached<T>> => {
    if (inflight) return inflight;
    const gen = generation;
    const at = Date.now();
    const p = load().then(
      value => {
        const fresh = { value, at };
        if (gen === generation) good = fresh;
        return fresh;
      },
      (err: unknown) => {
        if (gen === generation) failedAt = Date.now();
        throw err;
      },
    );
    inflight = p;
    const clear = () => {
      if (inflight === p) inflight = null;
    };
    p.then(clear, clear);
    return p;
  };

  return {
    get(): Promise<Cached<T>> {
      const now = Date.now();
      if (!good) return refresh();
      if (now - good.at > ttlMs && now - failedAt > ttlMs) refresh().catch(() => undefined);
      return Promise.resolve(good);
    },
    invalidate() {
      generation++;
      good = null;
      inflight = null;
      failedAt = 0;
    },
  };
}

export type Page<T> = { nodes: T[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } };

export async function paginate<T>(fetchPage: (after: string | null) => Promise<Page<T>>, maxPages: number): Promise<T[]> {
  const out: T[] = [];
  let after: string | null = null;
  for (let i = 0; i < maxPages; i++) {
    const page = await fetchPage(after);
    out.push(...page.nodes);
    if (!page.pageInfo.hasNextPage || !page.pageInfo.endCursor) return out;
    after = page.pageInfo.endCursor;
  }
  throw new RemoteError(`more than ${maxPages} pages`);
}
