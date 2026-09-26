import type { BunRequest } from "bun";
import { z } from "zod";
import { parsePeek } from "@/shared/refs";
import type { ServerMessage } from "@/shared/schema";
import { GithubMoveSchema, PriorityItemSchema, LinearMoveSchema, LocalBlockSchema, LocalMoveSchema, TaskOrderSchema } from "@/shared/tasks";
import type { Config } from "../config";
import type { Db } from "../db";
import type { GithubApi } from "../githubApi";
import { readWrite, remoteWrite } from "../http";
import { createDailyStore, type WriteResult } from "./daily/store";
import { createGithub } from "./github";
import { createJev } from "../jev";
import { createRankingStore, RANKING_ROWS } from "../ranking";
import { createLinear } from "./linear";
import { createPrStates } from "./prStates";
import { createPriority } from "./priority";
import { createOrderStore } from "./orderStore";

export type TasksDeps = {
  config: Config["tasks"];
  db: Db;
  github: GithubApi;
  publish: (msg: ServerMessage) => void;
};

const written = (out: WriteResult) => (out.ok ? Response.json(out) : Response.json({ error: out.error }, { status: out.status }));

export function createTasks(deps: TasksDeps) {
  const { config } = deps;
  const daily = createDailyStore({
    vaultDir: config.vaultDir,
    carryDays: config.carryDays,
    settleMs: config.settleMs,
    onChange: snapshot => deps.publish({ type: "tasks-local", snapshot }),
  });
  const linear = createLinear({ ...config.linear, limits: config.remote });
  const github = createGithub({ api: deps.github, limits: config.remote });
  const { jev, ...ranking } = config.priority;
  const priority = createPriority({
    ...ranking,
    jev: jev && createJev(jev),
    saved: createRankingStore(deps.db, RANKING_ROWS.priority, PriorityItemSchema),
    prStates: createPrStates(deps.github),
    local: () => daily.snapshot(),
    linear: () => linear.snapshot(),
    github: () => github.snapshot(),
  });

  const order = createOrderStore(deps.db);

  const routes = {
    "/api/tasks/order": {
      GET: () => Response.json(order.load()),
      POST: async (req: Request) => {
        const r = await readWrite(req, TaskOrderSchema, "{ source, keys }");
        if (!r.ok) return r.res;
        order.save(r.body);
        return Response.json({ ok: true });
      },
    },
    "/api/tasks/local": () => Response.json(daily.snapshot()),
    "/api/tasks/local/move": {
      POST: async (req: Request) => {
        const r = await readWrite(req, LocalMoveSchema, "{ date, line, raw, to }");
        return r.ok ? written(await daily.move(r.body)) : r.res;
      },
    },
    "/api/tasks/local/block": {
      POST: async (req: Request) => {
        const r = await readWrite(req, LocalBlockSchema, "{ date, line, block, next }");
        return r.ok ? written(await daily.editBlock(r.body)) : r.res;
      },
    },
    "/api/tasks/local/today": {
      POST: async (req: Request) => {
        const r = await readWrite(req, z.object({}), "{}");
        return r.ok ? written(await daily.createToday()) : r.res;
      },
    },
    "/api/tasks/linear": async () => Response.json(await linear.snapshot()),
    "/api/tasks/linear/issue": async (req: BunRequest) => {
      const peek = parsePeek(new URL(req.url).searchParams.get("id"));
      return peek?.kind === "linear" ? Response.json(await linear.issue(peek.id)) : Response.json({ error: "expected ?id=TEAM-123" }, { status: 400 });
    },
    "/api/tasks/linear/move": {
      POST: async (req: Request) => {
        const r = await readWrite(req, LinearMoveSchema, "{ id, to }");
        return r.ok ? remoteWrite(() => linear.move(r.body)) : r.res;
      },
    },
    "/api/tasks/github": async () => Response.json(await github.snapshot()),
    "/api/tasks/github/ref": async (req: BunRequest) => {
      const peek = parsePeek(new URL(req.url).searchParams.get("ref"));
      return peek?.kind === "github" ? Response.json(await github.ref(peek.repo, peek.number)) : Response.json({ error: "expected ?ref=owner/repo/number" }, { status: 400 });
    },
    "/api/tasks/github/move": {
      POST: async (req: Request) => {
        const r = await readWrite(req, GithubMoveSchema, "{ id, to: open | closed }");
        return r.ok ? remoteWrite(() => github.move(r.body)) : r.res;
      },
    },
    "/api/tasks/priority": async () => Response.json(await priority.snapshot()),
    "/api/tasks/priority/refresh": {
      POST: async (req: Request) => {
        const r = await readWrite(req, z.object({}), "{}");
        return r.ok ? Response.json(await priority.refresh()) : r.res;
      },
    },
  };

  return { routes, start: () => daily.start(), localSnapshot: () => daily.snapshot(), linearSnapshot: () => linear.snapshot(), githubSnapshot: () => github.snapshot(), prioritySnapshot: () => priority.snapshot() };
}
