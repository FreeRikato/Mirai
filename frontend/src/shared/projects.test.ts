import { describe, expect, test } from "bun:test";
import { buildModel, stackColumns, squarify, type HostProjects, type ProjectsSnapshot } from "./projects";

const MB = 1 << 20;

function snap(over: Partial<ProjectsSnapshot>): ProjectsSnapshot {
  return { at: 1, root: "/home/a/Developer", worktrees: [], listeners: [], links: [], containers: [], ...over };
}

const wt = (path: string, repo: string, branch: string | null = "main") => ({ path, repo, branch, dirty: 0, ahead: null, behind: null, lastCommit: null });
const listener = (port: number, pid: number | null, cwd: string | null, process = "node", mem = 10) => ({ port, bind: "0.0.0.0", pid, process, command: process, cwd, memBytes: mem * MB });

const BE = "/home/a/Developer/Work/databrain-backend";
const FE = "/home/a/Developer/Work/databrain-frontend";

const archikato: HostProjects = {
  host: "archikato",
  error: null,
  snapshot: snap({
    worktrees: [wt(BE, BE, "develop"), wt(`${BE}/worktrees/qa`, BE, "qa"), wt(FE, FE, "develop"), wt(`${FE}/worktrees/qa`, FE, "qa"), wt(`${BE}/worktrees/idle`, BE, "idle")],
    listeners: [
      listener(20103, 11, `${BE}/worktrees/qa/serverless/express`, "node", 49),
      listener(20101, 12, `${FE}/worktrees/qa/packages/frontend`, "node", 6),
      listener(20182, null, null, "docker-proxy"),
      listener(3773, 13, "/home/a", "t3", 180),
      listener(4000, 17, "/home/a", "node-MainThread", 20),
      listener(21999, 14, `${BE}/worktrees/gone/forecast (deleted)`, "python", 5),
      listener(8811, 15, "/home/a/Developer/Personal/arena", "bun", 3),
      listener(8811, 16, "/home/a/Developer/Personal/arena", "bun", 3),
    ],
    links: [
      { pid: 12, port: 20103 },
      { pid: 11, port: 20182 },
      { pid: 11, port: 5433 },
      { pid: 99, port: 20103 },
    ],
    containers: [
      { name: "qa-graphql-engine-1", composeProject: "qa", composeService: "graphql-engine", workingDir: `${BE}/worktrees/qa`, ports: [20182], memBytes: 394 * MB },
      { name: "wt-shared-postgres-1", composeProject: "wt-shared", composeService: "postgres", workingDir: "/home/a/Developer/Work/shared", ports: [5433], memBytes: 39 * MB },
      { name: "hindsight", composeProject: "hindsight", composeService: "hindsight", workingDir: "/home/a/.hermes/hindsight", ports: [8888], memBytes: 134 * MB },
      { name: "jellyfin", composeProject: null, composeService: null, workingDir: null, ports: [8096], memBytes: 29 * MB },
    ],
  }),
};

const macato: HostProjects = {
  host: "macato",
  error: null,
  snapshot: snap({ root: "/Users/a/Developer", worktrees: [wt("/Users/a/Developer/Work/databrain-backend", "/Users/a/Developer/Work/databrain-backend", "develop")], listeners: [listener(8083, 21, "/Users/a/Developer/Work/databrain-backend/forecast", "python", 10)] }),
};

describe("buildModel", () => {
  const model = buildModel([archikato, macato], { hidden: [], tools: false });
  const project = (id: string) => model.projects.find(p => p.id === id);

  test("repos that share a name prefix form one project with a lane per host and worktree", () => {
    const db = project("databrain");
    expect(db?.lanes.map(l => [l.host, l.label])).toEqual([
      ["archikato", "qa"],
      ["macato", "develop"],
    ]);
    const qa = db?.lanes[0];
    expect(qa?.worktrees.map(w => w.repoName)).toEqual(["databrain-backend", "databrain-frontend"]);
    expect(qa?.services.map(s => [s.name, s.ports])).toEqual([
      ["frontend", [20101]],
      ["express", [20103]],
      ["graphql-engine", [20182]],
    ]);
  });

  test("worktrees without a running service are counted as idle, not drawn", () => {
    expect(project("databrain")?.idle.map(w => w.path)).toEqual([BE, `${BE}/worktrees/idle`, FE]);
  });

  test("a process whose folder was deleted or sits outside any worktree is an orphan with a reason", () => {
    const orphans = project("orphans")?.lanes.flatMap(l => l.services);
    expect(orphans?.map(s => [s.ports[0], s.flags])).toEqual([
      [8811, ["no-worktree", "double-bind"]],
      [8811, ["no-worktree", "double-bind"]],
      [21999, ["cwd-deleted"]],
    ]);
  });

  test("compose projects under ~/Developer but outside any worktree become shared infra; ones elsewhere are host tools", () => {
    expect(project("infra:wt-shared")?.lanes[0]?.services.map(s => s.name)).toEqual(["postgres"]);
    expect(project("infra:hindsight")).toBeUndefined();
  });

  test("a service is named after the folder it runs from, falling back to a tidied process name", () => {
    expect(project("databrain")?.lanes[1]?.services.map(s => s.name)).toEqual(["forecast"]);
    expect(project("orphans")?.lanes[0]?.services.map(s => s.name)).toEqual(["arena", "arena", "forecast"]);
  });

  test("links become edges between services, reaching containers through their published port", () => {
    const name = new Map(model.projects.flatMap(p => p.lanes.flatMap(l => l.services.map(s => [s.id, `${s.name}:${s.ports[0]}`] as const))));
    expect(model.edges.map(e => `${name.get(e.from)} -> ${name.get(e.to)}`).sort()).toEqual(["express:20103 -> graphql-engine:20182", "express:20103 -> postgres:5433", "frontend:20101 -> express:20103"]);
  });

  test("host tools only appear when asked for, and hidden hosts disappear with their edges", () => {
    expect(project("tools")).toBeUndefined();
    const withTools = buildModel([archikato, macato], { hidden: [], tools: true });
    expect(withTools.projects.find(p => p.id === "tools")?.lanes[0]?.services.map(s => s.name)).toEqual(["t3", "node", "jellyfin", "hindsight"]);
    const noArchikato = buildModel([archikato, macato], { hidden: ["archikato"], tools: false });
    expect(noArchikato.projects.map(p => p.id)).toEqual(["databrain"]);
    expect(noArchikato.edges).toEqual([]);
  });
});

describe("squarify", () => {
  test("fills the rectangle exactly with areas proportional to values", () => {
    const rects = squarify([{ id: "a", value: 6 }, { id: "b", value: 3 }, { id: "c", value: 1 }], { x: 0, y: 0, w: 100, h: 50 });
    const area = (id: string) => {
      const r = rects.find(q => q.id === id);
      return r ? Math.round(r.w * r.h) : 0;
    };
    expect([area("a"), area("b"), area("c")]).toEqual([3000, 1500, 500]);
    expect(rects.every(r => r.x >= 0 && r.y >= 0 && r.x + r.w <= 100.001 && r.y + r.h <= 50.001)).toBe(true);
  });
});

describe("stackColumns", () => {
  test("callers sit left of what they call, and unconnected services start at the left", () => {
    const cols = stackColumns(["fe", "api", "db", "lone"], [
      { from: "fe", to: "api" },
      { from: "api", to: "db" },
      { from: "fe", to: "db" },
    ]);
    expect(cols).toEqual(new Map([["fe", 0], ["api", 1], ["db", 2], ["lone", 0]]));
  });
});
