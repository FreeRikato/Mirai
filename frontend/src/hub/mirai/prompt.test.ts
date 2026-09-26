import { expect, test } from "bun:test";
import { systemPrompt } from "./prompt";

test("the prompt maps where Mirai's data lives from the hub's own config and live host list", () => {
  let hosts: string[] = ["archikato", "omarikato"];
  const map = { owner: "Ada", machine: "archikato", home: "/home/archikato", hubUrl: "http://127.0.0.1:3131", dbPath: "/home/archikato/mirai/data/mirai.db", wikiDir: "/srv/wiki", vaultDir: undefined, agentPort: 7171, hosts: () => hosts };
  const prompt = systemPrompt(map);
  expect(prompt).toContain("Ada's personal dashboard");
  expect(prompt).toContain("read /srv/wiki/CLAUDE.md");
  expect(prompt).toContain("curl -s http://<host>:7171/{metrics,detail,projects,tailnet,usage,limits}");
  expect(prompt).toContain("Hosts right now: archikato, omarikato.");
  expect(prompt).toContain("sqlite3 -readonly");
  expect(prompt).toContain("http://127.0.0.1:3131/api/later/<id>/reader");
  expect(prompt).toContain("vault: not configured");
  expect(prompt).toContain("[▶ mm:ss](/content/item/<id>?t=<seconds>)");
  expect(prompt).toContain("/content/item/<id>?q=");
  hosts = [];
  expect(systemPrompt(map)).toContain("Hosts right now: ask the machines tool.");
});
