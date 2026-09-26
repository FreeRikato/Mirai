import { describe, expect, test } from "bun:test";
import { assignColors, buildEdges, buildMachines, latestVersion, tailnetInfos } from "./fleet";
import { status } from "./__fixtures__/status";

describe("tailnetInfos", () => {
  const infos = tailnetInfos(status);

  test("keeps desktop OS machines only, self first, named by MagicDNS", () => {
    expect(infos.map(i => i.name)).toEqual(["macato", "archikato", "awsakato", "omarikato"]);
  });

  test("a peer with a home relay but a CurAddr is direct; without CurAddr it is relayed", () => {
    const by = new Map(infos.map(i => [i.name, i.path]));
    expect(by.get("omarikato")).toEqual({ kind: "direct", addr: "192.168.200.105:41641" });
    expect(by.get("archikato")).toEqual({ kind: "relay", region: "sin" });
    expect(by.get("awsakato")).toEqual({ kind: "none" });
    expect(by.get("macato")).toEqual({ kind: "self" });
  });
});

describe("buildMachines", () => {
  test("online without agent metrics is no-agent, tailscale offline is offline", () => {
    const kinds = buildMachines(tailnetInfos(status), new Map(), 3).map(m => [m.ts.name, m.kind]);
    expect(kinds).toEqual([["macato", "no-agent"], ["archikato", "no-agent"], ["awsakato", "offline"], ["omarikato", "no-agent"]]);
  });
});

test("assignColors is stable per name and never repeats a hue", () => {
  const a = assignColors(["macato", "omarikato", "archikato", "awsakato"]);
  const b = assignColors(["awsakato", "archikato", "omarikato", "macato"]);
  expect(a).toEqual(b);
  expect(new Set(a.values()).size).toBe(4);
});

test("buildEdges keeps one edge per pair and drops unknown peers", () => {
  const edges = buildEdges(
    new Map([
      ["omarikato", { at: 0, pings: [{ peer: "macato", via: "direct", region: null, ms: 5 }, { peer: "iphone", via: "relay", region: "blr", ms: 90 }] }],
      ["macato", { at: 0, pings: [{ peer: "omarikato", via: "direct", region: null, ms: 6 }] }],
    ]),
    new Set(["macato", "omarikato"]),
  );
  expect(edges).toEqual([{ a: "macato", b: "omarikato", via: "direct", region: null, ms: 6 }]);
});

test("latestVersion compares numerically", () => {
  expect(latestVersion(["1.84.1", "1.102.3", "", "1.9.0"])).toBe("1.102.3");
});
