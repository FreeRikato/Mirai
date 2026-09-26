import { afterEach, expect, test } from "bun:test";
import { createGithubClients } from "./githubApi";

type Reply = { status: number; body?: unknown; headers?: Record<string, string> };

let server: ReturnType<typeof Bun.serve> | null = null;

afterEach(() => {
  server?.stop(true);
  server = null;
});

function fakeGithub(replies: Reply[]) {
  const seen: { path: string; ifNoneMatch: string | null }[] = [];
  server = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      seen.push({ path: url.pathname, ifNoneMatch: req.headers.get("if-none-match") });
      const reply = replies.shift() ?? { status: 500 };
      return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), { status: reply.status, headers: reply.headers });
    },
  });
  const { rest } = createGithubClients({ token: "t", url: `http://localhost:${server.port}/graphql`, timeoutMs: 2_000 });
  return { rest, seen };
}

const inAnHour = () => String(Math.floor(Date.now() / 1000) + 3_600);
const limited: Reply = { status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": inAnHour() } };

test("an unchanged resource is revalidated with its etag and served from the 304", async () => {
  const { rest, seen } = fakeGithub([{ status: 200, body: ["a.ts"], headers: { etag: '"v1"' } }, { status: 304 }]);
  expect(await rest("/files")).toEqual(["a.ts"]);
  expect(await rest("/files")).toEqual(["a.ts"]);
  expect(seen.map(s => s.ifNoneMatch)).toEqual([null, '"v1"']);
});

test("once rate limited it serves the last good body and stops calling until the reset", async () => {
  const { rest, seen } = fakeGithub([{ status: 200, body: ["a.ts"], headers: { etag: '"v1"' } }, limited]);
  await rest("/files");
  expect(await rest("/files")).toEqual(["a.ts"]);
  expect(await rest("/files")).toEqual(["a.ts"]);
  expect(seen).toHaveLength(2);
});

test("a rate limit with nothing cached names the reset time instead of a bare status", async () => {
  const { rest, seen } = fakeGithub([limited]);
  await expect(rest("/files")).rejects.toThrow(/rate limit.*resets at/);
  await expect(rest("/other")).rejects.toThrow(/rate limit.*resets at/);
  expect(seen).toHaveLength(1);
});

test("a plain 403 is an ordinary error and does not block later calls", async () => {
  const { rest, seen } = fakeGithub([{ status: 403, headers: { "x-ratelimit-remaining": "4000" } }, { status: 200, body: [] }]);
  await expect(rest("/files")).rejects.toThrow("answered 403");
  expect(await rest("/files")).toEqual([]);
  expect(seen).toHaveLength(2);
});
