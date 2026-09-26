import { afterAll, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { render, runDoctor, type Check } from "./checks";

const root = mkdtempSync(join(tmpdir(), "mirai-doctor-"));
const fakeTailscale = join(root, "tailscale");
writeFileSync(fakeTailscale, `#!/bin/sh\necho '${JSON.stringify({ Version: "1", Self: { ID: "s", DNSName: "box.tail0000.ts.net.", HostName: "box", OS: "linux", Online: true, TailscaleIPs: ["127.0.0.1"] } })}'\n`);
chmodSync(fakeTailscale, 0o755);

const fleet = { at: 1, tailnet: "tail0000.ts.net", edges: [], latestVersion: null, machines: [{ kind: "live", color: "#fff", ts: { name: "box" }, metrics: { cpu: { load: 12.4 } } }] };
const stub = Bun.serve({
  port: 0,
  fetch: req => {
    const path = new URL(req.url).pathname;
    if (path === "/metrics") return Response.json({});
    if (path === "/api/fleet") return Response.json(fleet);
    return new Response("{}", { status: 401 });
  },
});
afterAll(() => stub.stop(true));
const url = `http://127.0.0.1:${stub.port}`;

const byName = (checks: readonly Check[], name: string) => checks.find(c => c.name === name);

test("rejected keys fail their checks without any key reaching the report", async () => {
  const checks = await runDoctor({
    env: { TAILSCALE_BIN: "false", GITHUB_GRAPHQL_URL: `${url}/graphql`, LINEAR_API_KEY: "lin_planted", LINEAR_API_URL: `${url}/graphql`, OPENROUTER_API_KEY: "or_planted", OPENROUTER_DECISIONS_URL: `${url}/api/alpha/decisions` },
    root,
    hubUrl: url,
    githubToken: async () => "ghp_planted",
  });
  for (const name of ["github", "linear", "openrouter"]) expect(byName(checks, name)).toMatchObject({ status: "fail", detail: `rejected: 127.0.0.1:${stub.port} answered 401` });
  expect(byName(checks, "openai")?.status).toBe("off");
  expect(render(checks)).not.toContain("planted");
});

test("the hub check passes only when the hub reports this machine live through its agent", async () => {
  const checks = await runDoctor({ env: { TAILSCALE_BIN: fakeTailscale, MIRAI_AGENT_PORT: String(stub.port) }, root, hubUrl: url, githubToken: async () => null });
  expect(byName(checks, "tailscale")).toMatchObject({ status: "ok", detail: "this machine is box" });
  expect(byName(checks, "agent")?.status).toBe("ok");
  expect(byName(checks, "hub")).toMatchObject({ status: "ok", detail: "1 machine on the tailnet, 1 reporting; box at 12% cpu" });
  fleet.machines = [{ kind: "no-agent", color: "#fff", ts: { name: "box" }, metrics: { cpu: { load: 12.4 } } }];
  expect(byName(await runDoctor({ env: { TAILSCALE_BIN: fakeTailscale, MIRAI_AGENT_PORT: String(stub.port) }, root, hubUrl: url, githubToken: async () => null }), "hub")?.status).toBe("fail");
});

test("an invalid setting stops the doctor before it probes anything", async () => {
  const checks = await runDoctor({ env: { PORT: "eighty" }, root, hubUrl: url, githubToken: async () => "ghp_planted" });
  expect(checks.at(-1)).toMatchObject({ name: "settings", status: "fail" });
  expect(byName(checks, "github")).toBeUndefined();
});
